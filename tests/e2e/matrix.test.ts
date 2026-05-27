/**
 * Structured-data test matrix.
 *
 * For each variant × page type:
 *  1. Visits the page
 *  2. Extracts all signals (dataLayer, JSON-LD, OG, CEDDL)
 *  3. Runs sanity assertions against the variant's declared config
 *  4. Accumulates a gap report (written to automapper/reports/gap-report.json)
 *
 * The gap report is the primary output — it drives the automapper.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  extractSignals,
  findJsonLdByType,
  findDlEvents,
  extractDlItems,
  PageSignals,
} from './helpers';

// ─── TARGET SCHEMA ────────────────────────────────────────────────────────────
// Fields Criteo needs per product page (union of what all sources could supply)
const PRODUCT_FIELDS = [
  'productId', 'productName', 'brand', 'price', 'currency',
  'category', 'availability', 'image', 'description',
  'gtin', 'color', 'size', 'gender', 'rating', 'ratingCount',
] as const;

type Field = typeof PRODUCT_FIELDS[number];

// ─── VARIANT CONFIG (mirrors scripts/variant-configs.js) ─────────────────────
const VARIANTS = [
  { id: 'c1', dataLayer: 'ga4',         jsonLd: 'full',     openGraph: 'full'       },
  { id: 'c2', dataLayer: 'ga4',         jsonLd: false,      openGraph: false        },
  { id: 'c3', dataLayer: 'suppress',    jsonLd: 'full',     openGraph: false        },
  { id: 'c4', dataLayer: 'suppress',    jsonLd: false,      openGraph: 'full'       },
  { id: 'c5', dataLayer: 'ga4',         jsonLd: 'full',     openGraph: false        },
  { id: 'c6', dataLayer: 'ga4',         jsonLd: false,      openGraph: 'full'       },
  { id: 'c7', dataLayer: 'suppress',    jsonLd: 'no-price', openGraph: 'price-only' },
  { id: 'c8', dataLayer: 'nonstandard', jsonLd: false,      openGraph: false        },
  { id: 'c9', dataLayer: 'partial',     jsonLd: 'minimal',  openGraph: 'minimal'    },
  { id: 'c10', dataLayer: 'ceddl',      jsonLd: 'full',     openGraph: 'full'       },
  { id: 'c11', dataLayer: 'suppress',    jsonLd: false,      openGraph: false        },
] as const;

const PAGE_MATRIX = [
  { type: 'product',  path: '/product/TSHIRT-001-RED-M.html' },
  { type: 'product',  path: '/product/SHOE-003-WHT-42.html'  },
  { type: 'category', path: '/category/apparel.html'          },
  { type: 'homepage', path: '/'                               },
] as const;

// ─── GAP REPORT ACCUMULATOR ──────────────────────────────────────────────────

interface GapEntry {
  variant: string;
  pageType: string;
  url: string;
  presentFields: Partial<Record<Field, { source: string; value: unknown }>>;
  missingFields: Field[];
  activeSources: string[];
}

const gapReport: GapEntry[] = [];

// ─── SIGNAL EXTRACTION HELPERS ───────────────────────────────────────────────

function extractProductFields(
  signals: PageSignals,
  dlMode: string,
): Partial<Record<Field, { source: string; value: unknown }>> {
  const found: Partial<Record<Field, { source: string; value: unknown }>> = {};

  // ── DataLayer ──
  if (dlMode === 'ga4' || dlMode === 'partial') {
    const viewItem = findDlEvents(signals.dataLayer, 'view_item')[0];
    if (viewItem) {
      const items = extractDlItems(viewItem);
      const item = items[0];
      if (item) {
        if (item['item_id'])       found['productId']    = { source: 'dataLayer', value: item['item_id'] };
        if (item['item_name'])     found['productName']  = { source: 'dataLayer', value: item['item_name'] };
        if (item['item_brand'])    found['brand']        = { source: 'dataLayer', value: item['item_brand'] };
        if (item['price'])         found['price']        = { source: 'dataLayer', value: item['price'] };
        if (item['item_category']) found['category']     = { source: 'dataLayer', value: item['item_category'] };
        if (item['item_variant'])  found['color']        = { source: 'dataLayer', value: item['item_variant'] };
      }
      const ec = viewItem['ecommerce'] as Record<string, unknown> | undefined;
      if (ec?.['currency']) found['currency'] = { source: 'dataLayer', value: ec['currency'] };
    }
  }

  if (dlMode === 'nonstandard') {
    const viewItem = findDlEvents(signals.dataLayer, 'productDetailView')[0];
    if (viewItem) {
      const items = extractDlItems(viewItem);
      const item = items[0];
      if (item) {
        if (item['productId'])   found['productId']   = { source: 'dataLayer(nonstandard)', value: item['productId'] };
        if (item['productName']) found['productName'] = { source: 'dataLayer(nonstandard)', value: item['productName'] };
        if (item['brand'])       found['brand']       = { source: 'dataLayer(nonstandard)', value: item['brand'] };
        if (item['unitPrice'])   found['price']       = { source: 'dataLayer(nonstandard)', value: item['unitPrice'] };
        if (item['category'])    found['category']    = { source: 'dataLayer(nonstandard)', value: item['category'] };
      }
      const ec = viewItem['commerce'] as Record<string, unknown> | undefined;
      if (ec?.['currencyCode']) found['currency'] = { source: 'dataLayer(nonstandard)', value: ec['currencyCode'] };
    }
  }

  if (dlMode === 'ceddl' && signals.digitalData) {
    const products = (signals.digitalData as any)?.product as unknown[] | undefined;
    const p = Array.isArray(products) ? (products[0] as any) : null;
    if (p) {
      const info = p?.productInfo || {};
      if (info.productID)   found['productId']   = { source: 'ceddl', value: info.productID };
      if (info.productName) found['productName'] = { source: 'ceddl', value: info.productName };
      if (info.manufacturer) found['brand']      = { source: 'ceddl', value: info.manufacturer };
      if (p?.price?.basePrice) found['price']    = { source: 'ceddl', value: p.price.basePrice };
      if (p?.price?.currency)  found['currency'] = { source: 'ceddl', value: p.price.currency };
      if (p?.category?.primaryCategory) found['category'] = { source: 'ceddl', value: p.category.primaryCategory };
      const attrs = p?.attributes || {};
      if (attrs.color) found['color'] = { source: 'ceddl', value: attrs.color };
      if (attrs.size)  found['size']  = { source: 'ceddl', value: attrs.size };
      if (attrs.gender) found['gender'] = { source: 'ceddl', value: attrs.gender };
    }
  }

  // ── JSON-LD ──
  const productLd = findJsonLdByType(signals.jsonLd, 'Product');
  if (productLd) {
    if (!found['productId'])   found['productId']   = { source: 'jsonLd', value: productLd['sku'] };
    if (!found['productName']) found['productName'] = { source: 'jsonLd', value: productLd['name'] };
    const brand = productLd['brand'] as any;
    if (!found['brand'] && brand) found['brand']   = { source: 'jsonLd', value: brand?.name ?? brand };
    if (!found['category'])    found['category']   = { source: 'jsonLd', value: productLd['category'] };
    if (!found['description']) found['description'] = { source: 'jsonLd', value: productLd['description'] };
    if (!found['image'])       found['image']       = { source: 'jsonLd', value: (productLd['image'] as any[])?.[0] ?? productLd['image'] };
    if (!found['color'])       found['color']       = { source: 'jsonLd', value: productLd['color'] };
    if (!found['size'])        found['size']        = { source: 'jsonLd', value: productLd['size'] };
    const aud = productLd['audience'] as any;
    if (!found['gender'] && aud) found['gender']   = { source: 'jsonLd', value: aud?.suggestedGender };
    // GTIN (any variant)
    for (const k of ['gtin8', 'gtin12', 'gtin13', 'gtin14', 'gtin']) {
      if (!found['gtin'] && productLd[k]) found['gtin'] = { source: 'jsonLd', value: productLd[k] };
    }
    const rating = productLd['aggregateRating'] as any;
    if (rating?.ratingValue) found['rating']      = { source: 'jsonLd', value: rating.ratingValue };
    if (rating?.reviewCount) found['ratingCount'] = { source: 'jsonLd', value: rating.reviewCount };
    const offer = productLd['offers'] as any;
    if (offer?.price)        found['price']        = found['price']    ?? { source: 'jsonLd', value: offer.price };
    if (offer?.priceCurrency) found['currency']   = found['currency'] ?? { source: 'jsonLd', value: offer.priceCurrency };
    if (offer?.availability) found['availability'] = { source: 'jsonLd', value: offer.availability };
  }

  // ── OpenGraph ──
  const og = signals.openGraph;
  if (!found['productId'] && og['product:retailer_item_id'])
    found['productId']    = { source: 'openGraph', value: og['product:retailer_item_id'] };
  if (!found['productName'] && (og['og:title']))
    found['productName']  = { source: 'openGraph', value: og['og:title'] };
  if (!found['brand'] && og['product:brand'])
    found['brand']        = { source: 'openGraph', value: og['product:brand'] };
  if (!found['price'] && og['product:price:amount'])
    found['price']        = { source: 'openGraph', value: og['product:price:amount'] };
  if (!found['currency'] && og['product:price:currency'])
    found['currency']     = { source: 'openGraph', value: og['product:price:currency'] };
  if (!found['availability'] && og['product:availability'])
    found['availability'] = { source: 'openGraph', value: og['product:availability'] };
  if (!found['image'] && og['og:image'])
    found['image']        = { source: 'openGraph', value: og['og:image'] };
  if (!found['description'] && og['og:description'])
    found['description']  = { source: 'openGraph', value: og['og:description'] };
  if (!found['color'] && og['product:color'])
    found['color']        = { source: 'openGraph', value: og['product:color'] };
  if (!found['size'] && og['product:size'])
    found['size']         = { source: 'openGraph', value: og['product:size'] };
  if (!found['gender'] && og['product:gender'])
    found['gender']       = { source: 'openGraph', value: og['product:gender'] };

  return found;
}

function computeActiveSources(variant: typeof VARIANTS[number]): string[] {
  const s: string[] = [];
  if (variant.dataLayer && variant.dataLayer !== 'suppress') s.push(`dataLayer:${variant.dataLayer}`);
  if (variant.jsonLd)   s.push(`jsonLd:${variant.jsonLd}`);
  if (variant.openGraph) s.push(`openGraph:${variant.openGraph}`);
  return s;
}

// ─── TESTS ───────────────────────────────────────────────────────────────────

for (const variant of VARIANTS) {
  for (const pg of PAGE_MATRIX) {
    const testName = `[${variant.id}] ${pg.type} ${pg.path}`;

    test(testName, async ({ page }) => {
      const url = `/${variant.id}${pg.path}`;
      await page.goto(url);
      const signals = await extractSignals(page, variant.id, pg.type);

      // ── Sanity: page loaded ──
      expect(signals.title, `${testName}: page has title`).not.toBe('');

      // ── Sanity: dataLayer contract ──
      if (variant.dataLayer === 'ga4' || variant.dataLayer === 'partial') {
        const hasEvents = signals.dataLayer.some(e => (e['event'] as string)?.startsWith('view_'));
        expect(hasEvents, `${testName}: GA4 dataLayer has view_ events`).toBe(true);
      }
      if (variant.dataLayer === 'suppress') {
        const hasEcommerceEvents = signals.dataLayer.some(e => e['ecommerce'] || e['commerce']);
        expect(hasEcommerceEvents, `${testName}: suppressed DL has no ecommerce events`).toBe(false);
      }
      if (variant.dataLayer === 'nonstandard') {
        const hasCustomEvent = signals.dataLayer.some(
          e => String(e['eventName'] || '').includes('View') || String(e['eventName'] || '').includes('Detail'),
        );
        expect(hasCustomEvent, `${testName}: nonstandard DL has custom event names`).toBe(true);
      }

      // ── Sanity: JSON-LD contract ──
      if (variant.jsonLd === 'full' || variant.jsonLd === 'no-price') {
        if (pg.type === 'product') {
          const product = findJsonLdByType(signals.jsonLd, 'Product');
          expect(product, `${testName}: JSON-LD has Product schema`).not.toBeNull();
          if (variant.jsonLd === 'no-price') {
            expect((product as any)?.offers, `${testName}: no-price JSON-LD has no Offers`).toBeUndefined();
          }
        } else {
          // Category and homepage pages use ItemList / Organization, not Product
          const hasList = signals.jsonLd.some(b => b['@type'] === 'ItemList' || b['@type'] === 'Organization');
          expect(hasList, `${testName}: non-product JSON-LD has ItemList or Organization`).toBe(true);
        }
      }
      if (variant.jsonLd === false) {
        const product = findJsonLdByType(signals.jsonLd, 'Product');
        expect(product, `${testName}: suppressed JSON-LD has no Product`).toBeNull();
      }

      // ── Sanity: OG contract ──
      if (variant.openGraph === 'full') {
        expect(signals.openGraph['og:title'], `${testName}: OG has title`).toBeTruthy();
      }
      if (variant.openGraph === false) {
        expect(Object.keys(signals.openGraph).length, `${testName}: suppressed OG is empty`).toBe(0);
      }

      // ── Gap analysis (product pages only) ──
      if (pg.type === 'product') {
        const present = extractProductFields(signals, variant.dataLayer);
        const missing = PRODUCT_FIELDS.filter(f => !present[f]);
        const activeSources = computeActiveSources(variant);

        gapReport.push({
          variant: variant.id,
          pageType: pg.type,
          url: signals.url,
          presentFields: present,
          missingFields: missing,
          activeSources,
        });
      }
    });
  }
}

// Write gap report after all tests complete
test.afterAll(() => {
  const reportDir = path.join(__dirname, '..', 'automapper', 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, 'gap-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(gapReport, null, 2));
  console.log(`\nGap report written to ${reportPath}`);
  console.log(`Total entries: ${gapReport.length}`);

  const variants = [...new Set(gapReport.map(e => e.variant))];
  for (const v of variants) {
    const entries = gapReport.filter(e => e.variant === v);
    const allMissing = [...new Set(entries.flatMap(e => e.missingFields))];
    console.log(`  ${v}: missing ${allMissing.length} fields — [${allMissing.join(', ')}]`);
  }
});
