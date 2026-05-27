#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { VARIANTS, NONSTANDARD_FIELD_MAP } = require('./variant-configs');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const CATALOG_PATH = path.join(ROOT, 'catalog.csv');
const SITE_URL = process.env.SITE_URL || 'http://criteo-dynamic-test-shop.s3-website-us-east-1.amazonaws.com';

// ─── CSV ────────────────────────────────────────────────────────────────────

function parseCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { q = false; }
      else cur += c;
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"') { q = true; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseCatalog() {
  const text = fs.readFileSync(CATALOG_PATH, 'utf8');
  const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = vals[i] !== undefined ? vals[i] : ''; });
    return row;
  });
}

// ─── HTML HELPERS ────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function availability(qty) {
  const n = Number(qty);
  if (!n || n <= 0) return 'OutOfStock';
  if (n < 5) return 'LimitedAvailability';
  return 'InStock';
}

function gtinKey(g) {
  const s = String(g || '').trim();
  if (s.length === 8)  return 'gtin8';
  if (s.length === 12) return 'gtin12';
  if (s.length === 13) return 'gtin13';
  if (s.length === 14) return 'gtin14';
  return 'gtin';
}

function absUrl(p) {
  if (!p) return SITE_URL;
  if (/^https?:\/\//i.test(p)) return p;
  return SITE_URL + (p.startsWith('/') ? p : '/' + p);
}

// ─── DATALAYER BLOCKS ────────────────────────────────────────────────────────

function ga4Item(p, index = 0) {
  return {
    item_id: p.sku,
    item_name: p.name,
    item_brand: p.brand,
    item_category: p.category_1,
    item_category2: p.category_2,
    item_variant: p.variant,
    price: Number(p.price),
    quantity: 1,
    index,
  };
}

function nonstandardItem(p, index = 0) {
  const std = ga4Item(p, index);
  const out = {};
  for (const [k, v] of Object.entries(std)) {
    const mapped = NONSTANDARD_FIELD_MAP.itemFields[k] || k;
    out[mapped] = v;
  }
  return out;
}

function partialItem(p) {
  // Intentionally omits brand, category, variant, index
  return {
    item_id: p.sku,
    item_name: p.name,
    price: Number(p.price),
    quantity: 1,
  };
}

function ceddlProduct(p) {
  return {
    productInfo: {
      productID: p.sku,
      productName: p.name,
      manufacturer: p.brand,
      productURL: `${SITE_URL}/product/${encodeURIComponent(p.sku)}`,
      sku: p.sku,
      [gtinKey(p.gtin)]: p.gtin,
      mpn: p.mpn,
    },
    category: {
      primaryCategory: p.category_1,
      subCategory1: p.category_2,
    },
    attributes: {
      variant: p.variant,
      color: p.color,
      size: p.size,
      material: p.material,
      gender: p.gender,
    },
    price: {
      basePrice: Number(p.price),
      currency: 'EUR',
    },
    linkedProduct: [],
  };
}

function dataLayerBlock(mode, pageType, product, listProducts) {
  if (mode === 'suppress') {
    // Preserve GTM's own initialization — a hard reset destroys the gtm.start
    // event before gtm.js loads async, breaking GTM's PAGEVIEW trigger.
    return `<script>window.dataLayer = window.dataLayer || [];</script>`;
  }

  const events = [];

  if (mode === 'ga4') {
    events.push(`dataLayer.push({event:'page_view',page_type:'${pageType}'});`);

    if (pageType === 'product') {
      events.push(`dataLayer.push({
      event:'view_item',
      ecommerce:{
        currency:'EUR',
        value:${product.price},
        items:[${JSON.stringify(ga4Item(product, 0), null, 6)}]
      }
    });`);
    }

    if (pageType === 'category' || pageType === 'homepage') {
      const items = listProducts.slice(0, 8).map((p, i) => ga4Item(p, i));
      events.push(`dataLayer.push({
      event:'view_item_list',
      ecommerce:{
        item_list_name:'${pageType === 'homepage' ? 'Featured Products' : product.category_1}',
        item_list_id:'${pageType === 'homepage' ? 'homepage' : product.category_1.toLowerCase()}',
        items:${JSON.stringify(items, null, 6)}
      }
    });`);
    }
  }

  if (mode === 'nonstandard') {
    const em = NONSTANDARD_FIELD_MAP.events;
    const ef = NONSTANDARD_FIELD_MAP.ecommerceFields;

    events.push(`dataLayer.push({eventName:'${em.page_view}',pageType:'${pageType}'});`);

    if (pageType === 'product') {
      events.push(`dataLayer.push({
      eventName:'${em.view_item}',
      commerce:{
        ${ef.currency}:'EUR',
        ${ef.value}:${product.price},
        ${ef.items}:[${JSON.stringify(nonstandardItem(product, 0), null, 6)}]
      }
    });`);
    }

    if (pageType === 'category' || pageType === 'homepage') {
      const items = listProducts.slice(0, 8).map((p, i) => nonstandardItem(p, i));
      events.push(`dataLayer.push({
      eventName:'${em.view_item_list}',
      commerce:{
        listName:'${pageType === 'homepage' ? 'Featured' : product.category_1}',
        ${ef.items}:${JSON.stringify(items, null, 6)}
      }
    });`);
    }
  }

  if (mode === 'partial') {
    events.push(`dataLayer.push({event:'page_view',page_type:'${pageType}'});`);

    if (pageType === 'product') {
      // Intentionally no currency, no value at top level
      events.push(`dataLayer.push({
      event:'view_item',
      ecommerce:{
        items:[${JSON.stringify(partialItem(product), null, 6)}]
      }
    });`);
    }

    if (pageType === 'category' || pageType === 'homepage') {
      const items = listProducts.slice(0, 4).map(p => partialItem(p));
      events.push(`dataLayer.push({
      event:'view_item_list',
      ecommerce:{
        items:${JSON.stringify(items, null, 6)}
      }
    });`);
    }
  }

  if (mode === 'ceddl') {
    const digitalData = {
      pageInstanceID: `${pageType}-${product.sku || 'home'}`,
      page: {
        pageInfo: { pageID: pageType, pageName: pageType === 'product' ? product.name : product.category_1 },
        category: { primaryCategory: pageType },
      },
      product: pageType === 'product' ? [ceddlProduct(product)] : [],
      cart: {},
      transaction: {},
      user: [],
    };
    // For CEDDL we also push a minimal page_view to dataLayer so GTM fires
    events.push(`window.digitalData = ${JSON.stringify(digitalData, null, 4)};`);
    events.push(`dataLayer.push({event:'page_view',page_type:'${pageType}'});`);
  }

  return `<script data-static-dl="true">
  window.dataLayer = window.dataLayer || [];
  ${events.join('\n  ')}
  </script>`;
}

// ─── JSON-LD BLOCKS ──────────────────────────────────────────────────────────

function productJsonLd(mode, product) {
  if (!mode) return '';

  const url = `${SITE_URL}/product/${encodeURIComponent(product.sku)}`;
  const validUntil = new Date(Date.now() + 365 * 86400e3).toISOString().slice(0, 10);

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': url + '#product',
    name: product.name,
    sku: product.sku,
    url,
    image: [absUrl(product.image)],
  };

  if (mode === 'minimal') {
    // Only name + url — strip everything else
    return jsonLdTag(schema);
  }

  // Common fields for 'full' and 'no-price'
  schema.brand = { '@type': 'Brand', name: product.brand };
  schema.category = [product.category_1, product.category_2].filter(Boolean).join(' > ');
  if (product.description) schema.description = product.description;
  if (product.gtin) schema[gtinKey(product.gtin)] = product.gtin;
  if (product.mpn) schema.mpn = product.mpn;
  if (product.color) schema.color = product.color;
  if (product.size) schema.size = product.size;
  if (product.material) schema.material = product.material;
  if (product.gender) schema.audience = { '@type': 'PeopleAudience', suggestedGender: product.gender };
  if (product.rating_value && product.rating_count) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: product.rating_value,
      reviewCount: product.rating_count,
      bestRating: '5',
      worstRating: '1',
    };
  }
  schema.isVariantOf = {
    '@type': 'ProductGroup',
    productGroupID: product.id,
    variesBy: ['color', 'size'],
  };

  if (mode === 'no-price') {
    // No Offers block — price lives only in OG (complementary config)
    return jsonLdTag(schema);
  }

  // mode === 'full'
  schema.offers = {
    '@type': 'Offer',
    url,
    priceCurrency: 'EUR',
    price: Number(product.price).toFixed(2),
    priceValidUntil: validUntil,
    availability: 'https://schema.org/' + availability(product.quantity),
    itemCondition: 'https://schema.org/NewCondition',
    seller: { '@type': 'Organization', name: 'Fashion Shop' },
  };

  return jsonLdTag(schema);
}

function breadcrumbJsonLd(product) {
  return jsonLdTag({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL + '/' },
      { '@type': 'ListItem', position: 2, name: product.category_1, item: `${SITE_URL}/category/${encodeURIComponent(product.category_1.toLowerCase())}` },
      { '@type': 'ListItem', position: 3, name: product.name, item: `${SITE_URL}/product/${encodeURIComponent(product.sku)}` },
    ],
  });
}

function itemListJsonLd(products, name) {
  return jsonLdTag({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: products.length,
    itemListElement: products.slice(0, 20).map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_URL}/product/${encodeURIComponent(p.sku)}`,
      item: {
        '@type': 'Product',
        name: p.name,
        image: absUrl(p.image),
        sku: p.sku,
        brand: { '@type': 'Brand', name: p.brand },
        offers: {
          '@type': 'Offer',
          priceCurrency: 'EUR',
          price: Number(p.price).toFixed(2),
          availability: 'https://schema.org/' + availability(p.quantity),
        },
      },
    })),
  });
}

function organizationJsonLd() {
  return jsonLdTag({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Fashion Shop',
    url: SITE_URL,
    logo: absUrl('/images/hero-banner.png'),
    description: 'Curated apparel, footwear and accessories from leading brands.',
  });
}

function jsonLdTag(obj) {
  return `<script type="application/ld+json" data-static-jld="true">\n${JSON.stringify(obj, null, 2)}\n</script>`;
}

function jsonLdSection(mode, pageType, product, listProducts) {
  if (!mode) return '';

  const blocks = [];

  // For non-product pages, no-price behaves like full (no Offers restriction applies)
  const listMode = (mode === 'no-price') ? 'full' : mode;

  if (pageType === 'homepage') {
    if (listMode === 'full') {
      blocks.push(organizationJsonLd());
      blocks.push(itemListJsonLd(listProducts, 'Fashion Shop — All Products'));
    }
    return blocks.join('\n  ');
  }

  if (pageType === 'category') {
    if (listMode === 'full') {
      blocks.push(itemListJsonLd(listProducts, product.category_1));
      blocks.push(breadcrumbJsonLd({ ...product, name: product.category_1, sku: '', id: '' }));
    }
    return blocks.join('\n  ');
  }

  // product page
  blocks.push(productJsonLd(mode, product));
  if (mode === 'full') blocks.push(breadcrumbJsonLd(product));

  return blocks.join('\n  ');
}

// ─── OPENGRAPH BLOCKS ────────────────────────────────────────────────────────

function ogMeta(property, content) {
  if (!content && content !== 0) return '';
  return `<meta property="${esc(property)}" content="${esc(content)}" data-static-og="true">`;
}

function ogSection(mode, pageType, product, variantId) {
  if (!mode) return '';

  const productUrl = pageType === 'product'
    ? `${SITE_URL}/${variantId}/product/${encodeURIComponent(product.sku)}.html`
    : `${SITE_URL}/${variantId}/`;

  if (mode === 'price-only') {
    // Complementary: price/availability only, no brand/sku/color — JSON-LD fills those
    const lines = [
      ogMeta('og:title', product.name || 'Fashion Shop'),
      pageType === 'product' && ogMeta('product:price:amount', Number(product.price).toFixed(2)),
      pageType === 'product' && ogMeta('product:price:currency', 'EUR'),
      pageType === 'product' && ogMeta('product:availability', Number(product.quantity) > 0 ? 'in stock' : 'out of stock'),
    ];
    return lines.filter(Boolean).join('\n  ');
  }

  if (mode === 'minimal') {
    const lines = [
      ogMeta('og:title', pageType === 'product' ? `${product.name} — ${product.brand}` : 'Fashion Shop'),
      ogMeta('og:description', product.description || 'Curated apparel, footwear and accessories.'),
      ogMeta('og:url', productUrl),
    ];
    return lines.filter(Boolean).join('\n  ');
  }

  // mode === 'full'
  const title = pageType === 'product' ? `${product.name} — ${product.brand}` : 'Fashion Shop';
  const desc = pageType === 'product'
    ? (product.description || `${product.name} by ${product.brand}`)
    : 'Curated apparel, footwear and accessories from leading brands.';
  const image = absUrl(product.image || '/images/hero-banner.png');

  const lines = [
    ogMeta('og:type', pageType === 'product' ? 'product' : 'website'),
    ogMeta('og:title', title),
    ogMeta('og:description', desc),
    ogMeta('og:image', image),
    ogMeta('og:url', productUrl),
    ogMeta('og:site_name', 'Fashion Shop'),
    ogMeta('og:locale', 'en_US'),
    // Twitter Card
    ogMeta('name', 'twitter:card', 'summary_large_image'),
    ogMeta('name', 'twitter:title', title),
    ogMeta('name', 'twitter:description', desc),
    ogMeta('name', 'twitter:image', image),
  ];

  if (pageType === 'product') {
    lines.push(
      ogMeta('product:price:amount', Number(product.price).toFixed(2)),
      ogMeta('product:price:currency', 'EUR'),
      ogMeta('product:availability', Number(product.quantity) > 0 ? 'in stock' : 'out of stock'),
      ogMeta('product:condition', 'new'),
      ogMeta('product:brand', product.brand),
      ogMeta('product:retailer_item_id', product.sku),
      ogMeta('product:item_group_id', product.id),
      ogMeta('product:color', product.color),
      ogMeta('product:size', product.size),
      ogMeta('product:gender', product.gender),
    );
  }

  return lines.filter(Boolean).join('\n  ');
}

// ─── FULL PAGE TEMPLATE ──────────────────────────────────────────────────────

function dataBadge(v) {
  const sources = [];
  if (v.dataLayer && v.dataLayer !== 'suppress') sources.push(`DL:${v.dataLayer}`);
  if (v.jsonLd) sources.push(`JSON-LD:${v.jsonLd}`);
  if (v.openGraph) sources.push(`OG:${v.openGraph}`);
  if (!sources.length) sources.push('no-data-sources');
  return sources.join(' · ');
}

function productCard(product) {
  return `
  <article class="product" itemscope itemtype="https://schema.org/Product">
    <img src="${esc(absUrl(product.image))}" alt="${esc(product.name)}" width="300" height="300" loading="lazy">
    <h1 itemprop="name">${esc(product.name)}</h1>
    <p class="brand" itemprop="brand" itemscope itemtype="https://schema.org/Brand">
      <span itemprop="name">${esc(product.brand)}</span>
    </p>
    <p class="price" itemprop="offers" itemscope itemtype="https://schema.org/Offer">
      <span itemprop="priceCurrency" content="EUR">€</span><span itemprop="price" content="${esc(product.price)}">${esc(product.price)}</span>
    </p>
    <div style="margin: 18px 0;">
      <button id="pdp-add-to-cart" class="btn" style="background: #111; color: #fff; padding: 12px 24px; border: none; font-weight: bold; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 8px; font-size: 14px; transition: background 0.2s;" onmouseover="this.style.background='#333'" onmouseout="this.style.background='#111'" onclick="handleAddToCartClick()">
        🛒 Add to Cart
      </button>
    </div>
    <p class="category">${esc(product.category_1)} / ${esc(product.category_2)}</p>
    <p class="description" itemprop="description">${esc(product.description)}</p>
    <dl class="meta">
      <dt>SKU</dt><dd itemprop="sku">${esc(product.sku)}</dd>
      <dt>Color</dt><dd>${esc(product.color)}</dd>
      <dt>Size</dt><dd>${esc(product.size)}</dd>
      <dt>Material</dt><dd>${esc(product.material)}</dd>
      <dt>Gender</dt><dd>${esc(product.gender)}</dd>
      <dt>Rating</dt><dd itemprop="aggregateRating" itemscope itemtype="https://schema.org/AggregateRating">
        <span itemprop="ratingValue">${esc(product.rating_value)}</span> / 5 (${esc(product.rating_count)} reviews)</dd>
      <dt>GTIN</dt><dd>${esc(product.gtin)}</dd>
      <dt>MPN</dt><dd>${esc(product.mpn)}</dd>
    </dl>
  </article>`;
}

function productListCard(p) {
  return `
    <li class="card">
      <a href="/c${p._variantId}/product/${encodeURIComponent(p.sku)}.html">
        <img src="${esc(absUrl(p.image))}" alt="${esc(p.name)}" width="150" loading="lazy">
        <p>${esc(p.name)}</p>
        <p>€${esc(p.price)}</p>
      </a>
    </li>`;
}

function generatePage(variant, pageType, product, allProducts) {
  const listProducts = pageType === 'category'
    ? allProducts.filter(p => p.category_1.toLowerCase() === product.category_1.toLowerCase())
    : allProducts;

  const dlBlock = dataLayerBlock(variant.dataLayer, pageType, product, listProducts);
  const jldBlock = jsonLdSection(variant.jsonLd, pageType, product, listProducts);
  const ogBlock = ogSection(variant.openGraph, pageType, product, variant.id);

  let titleStr = 'Fashion Shop';
  if (pageType === 'product') titleStr = `${product.name} — ${product.brand} | Fashion Shop [${variant.id}]`;
  if (pageType === 'category') titleStr = `${product.category_1} | Fashion Shop [${variant.id}]`;
  if (pageType === 'homepage') titleStr = `Fashion Shop [${variant.id}]`;

  let bodyContent = '';
  if (pageType === 'product') {
    bodyContent = productCard(product);
  } else {
    const listItems = listProducts.slice(0, 12).map(p => productListCard({ ...p, _variantId: variant.id.replace('c', '') })).join('');
    bodyContent = `
  <h1>${esc(pageType === 'category' ? product.category_1 : 'Featured Products')}</h1>
  <ul class="product-grid">${listItems}
  </ul>`;
  }

  const variantsJson = JSON.stringify(VARIANTS);
  const nonstandardJson = JSON.stringify(NONSTANDARD_FIELD_MAP);
  const productJson = JSON.stringify(product || {});
  const listProductsJson = JSON.stringify(listProducts || []);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(titleStr)}</title>
  ${ogBlock ? ogBlock + '\n  ' : ''}
  ${jldBlock ? jldBlock + '\n  ' : ''}
  
  <!-- Dynamic Signal Override & Test Oracle Engine -->
  <script>
    (function() {
      // 1. Injected configuration from build script
      window.__variants = ${variantsJson};
      window.__nonstandardFieldMap = ${nonstandardJson};
      window.__pageType = "${pageType}";
      window.__productData = ${productJson};
      window.__listProducts = ${listProductsJson};
      window.__activeVariantId = "${variant.id}";
      window.__siteUrl = "${SITE_URL}";
      
      function getQueryParam(name) {
        const params = new URLSearchParams(window.location.search);
        return params.get(name);
      }
      
      function getActiveConfig() {
        const sessionOverride = sessionStorage.getItem('active_test_variant');
        const queryOverride = getQueryParam('variant');
        const activeId = queryOverride || sessionOverride || window.__activeVariantId;
        
        let cfg = window.__variants.find(v => v.id === activeId);
        if (!cfg) cfg = window.__variants.find(v => v.id === window.__activeVariantId) || window.__variants[0];
        
        const finalCfg = { ...cfg };
        
        const dlOverride = getQueryParam('dataLayer') || sessionStorage.getItem('override_dataLayer');
        if (dlOverride) finalCfg.dataLayer = dlOverride === 'false' ? false : dlOverride;
        
        const jldOverride = getQueryParam('jsonLd') || sessionStorage.getItem('override_jsonLd');
        if (jldOverride) finalCfg.jsonLd = jldOverride === 'false' ? false : jldOverride;
        
        const ogOverride = getQueryParam('openGraph') || sessionStorage.getItem('override_openGraph');
        if (ogOverride) finalCfg.openGraph = ogOverride === 'false' ? false : ogOverride;
        
        return finalCfg;
      }
      
      const activeCfg = getActiveConfig();
      window.__resolvedConfig = activeCfg;
      
      const hasOverrides = getQueryParam('variant') || getQueryParam('dataLayer') || getQueryParam('jsonLd') || getQueryParam('openGraph') ||
                            sessionStorage.getItem('active_test_variant') || sessionStorage.getItem('override_dataLayer') ||
                            sessionStorage.getItem('override_jsonLd') || sessionStorage.getItem('override_openGraph');
      
      function cleanStaticTags() {
        const selectAndRemove = (sel) => {
          const els = document.querySelectorAll(sel);
          els.forEach(el => el.parentNode.removeChild(el));
        };
        selectAndRemove('[data-static-og="true"]');
        selectAndRemove('[data-static-jld="true"]');
        selectAndRemove('[data-static-dl="true"]');
      }
      
      function availability(qty) {
        const n = Number(qty);
        if (!n || n <= 0) return 'OutOfStock';
        if (n < 5) return 'LimitedAvailability';
        return 'InStock';
      }
      
      function gtinKey(g) {
        const s = String(g || '').trim();
        if (s.length === 8) return 'gtin8';
        if (s.length === 12) return 'gtin12';
        if (s.length === 13) return 'gtin13';
        if (s.length === 14) return 'gtin14';
        return 'gtin';
      }
      
      function absUrl(p) {
        if (!p) return window.__siteUrl;
        if (/^https?:\/\//i.test(p)) return p;
        return window.__siteUrl + (p.startsWith('/') ? p : '/' + p);
      }
      
      function injectJsonLd(mode) {
        if (!mode) return;
        const pageType = window.__pageType;
        const product = window.__productData;
        const listProducts = window.__listProducts;
        const SITE_URL = window.__siteUrl;
        
        const blocks = [];
        const listMode = (mode === 'no-price') ? 'full' : mode;
        
        const organizationJsonLd = () => ({
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'Fashion Shop',
          url: SITE_URL,
          logo: absUrl('/images/hero-banner.png'),
          description: 'Curated apparel, footwear and accessories from leading brands.'
        });
        
        const itemListJsonLd = (products, name) => ({
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name,
          numberOfItems: products.length,
          itemListElement: products.slice(0, 20).map((p, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            url: SITE_URL + '/product/' + encodeURIComponent(p.sku) + '.html',
            item: {
              '@type': 'Product',
              name: p.name,
              image: absUrl(p.image),
              sku: p.sku,
              brand: { '@type': 'Brand', name: p.brand },
              offers: {
                '@type': 'Offer',
                priceCurrency: 'EUR',
                price: Number(p.price).toFixed(2),
                availability: 'https://schema.org/' + availability(p.quantity),
              }
            }
          }))
        });
        
        const breadcrumbJsonLd = (p) => ({
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL + '/' },
            { '@type': 'ListItem', position: 2, name: p.category_1, item: SITE_URL + '/category/' + encodeURIComponent(p.category_1.toLowerCase()) + '.html' },
            { '@type': 'ListItem', position: 3, name: p.name, item: SITE_URL + '/product/' + encodeURIComponent(p.sku) + '.html' }
          ]
        });
        
        const productJsonLd = (p) => {
          const url = SITE_URL + '/product/' + encodeURIComponent(p.sku) + '.html';
          const validUntil = new Date(Date.now() + 365 * 86400e3).toISOString().slice(0, 10);
          const schema = {
            '@context': 'https://schema.org',
            '@type': 'Product',
            '@id': url + '#product',
            name: p.name,
            sku: p.sku,
            url,
            image: [absUrl(p.image)]
          };
          if (mode === 'minimal') return schema;
          
          schema.brand = { '@type': 'Brand', name: p.brand };
          schema.category = [p.category_1, p.category_2].filter(Boolean).join(' > ');
          if (p.description) schema.description = p.description;
          if (p.gtin) schema[gtinKey(p.gtin)] = p.gtin;
          if (p.mpn) schema.mpn = p.mpn;
          if (p.color) schema.color = p.color;
          if (p.size) schema.size = p.size;
          if (p.material) schema.material = p.material;
          if (p.gender) schema.audience = { '@type': 'PeopleAudience', suggestedGender: p.gender };
          if (p.rating_value && p.rating_count) {
            schema.aggregateRating = {
              '@type': 'AggregateRating',
              ratingValue: p.rating_value,
              reviewCount: p.rating_count,
              bestRating: '5',
              worstRating: '1'
            };
          }
          schema.isVariantOf = {
            '@type': 'ProductGroup',
            productGroupID: p.id,
            variesBy: ['color', 'size']
          };
          if (mode === 'no-price') return schema;
          
          schema.offers = {
            '@type': 'Offer',
            url,
            priceCurrency: 'EUR',
            price: Number(p.price).toFixed(2),
            priceValidUntil: validUntil,
            availability: 'https://schema.org/' + availability(p.quantity),
            itemCondition: 'https://schema.org/NewCondition',
            seller: { '@type': 'Organization', name: 'Fashion Shop' }
          };
          return schema;
        };
        
        if (pageType === 'homepage') {
          if (listMode === 'full') {
            blocks.push(organizationJsonLd());
            blocks.push(itemListJsonLd(listProducts, 'Fashion Shop — All Products'));
          }
        } else if (pageType === 'category') {
          if (listMode === 'full') {
            blocks.push(itemListJsonLd(listProducts, product.category_1));
            blocks.push(breadcrumbJsonLd({ ...product, name: product.category_1, sku: '', id: '' }));
          }
        } else if (pageType === 'product') {
          blocks.push(productJsonLd(product));
          if (mode === 'full') blocks.push(breadcrumbJsonLd(product));
        }
        
        blocks.forEach(b => {
          const s = document.createElement('script');
          s.type = 'application/ld+json';
          s.setAttribute('data-dynamic-tag', 'true');
          s.textContent = JSON.stringify(b, null, 2);
          document.head.appendChild(s);
        });
      }
      
      function injectOpenGraph(mode) {
        if (!mode) return;
        const pageType = window.__pageType;
        const product = window.__productData;
        const variantId = activeCfg.id;
        const SITE_URL = window.__siteUrl;
        
        const productUrl = pageType === 'product'
          ? SITE_URL + '/' + variantId + '/product/' + encodeURIComponent(product.sku) + '.html'
          : SITE_URL + '/' + variantId + '/';
          
        const meta = (prop, val) => {
          if (!val && val !== 0) return;
          const m = document.createElement('meta');
          m.setAttribute('property', prop);
          m.setAttribute('content', String(val));
          m.setAttribute('data-dynamic-tag', 'true');
          document.head.appendChild(m);
        };
        
        if (mode === 'price-only') {
          meta('og:title', product.name || 'Fashion Shop');
          if (pageType === 'product') {
            meta('product:price:amount', Number(product.price).toFixed(2));
            meta('product:price:currency', 'EUR');
            meta('product:availability', Number(product.quantity) > 0 ? 'in stock' : 'out of stock');
          }
          return;
        }
        
        if (mode === 'minimal') {
          meta('og:title', pageType === 'product' ? product.name + ' — ' + product.brand : 'Fashion Shop');
          meta('og:description', product.description || 'Curated apparel, footwear and accessories.');
          meta('og:url', productUrl);
          return;
        }
        
        const title = pageType === 'product' ? product.name + ' — ' + product.brand : 'Fashion Shop';
        const desc = pageType === 'product'
          ? (product.description || product.name + ' by ' + product.brand)
          : 'Curated apparel, footwear and accessories from leading brands.';
        const image = absUrl(product.image || '/images/hero-banner.png');
        
        meta('og:type', pageType === 'product' ? 'product' : 'website');
        meta('og:title', title);
        meta('og:description', desc);
        meta('og:image', image);
        meta('og:url', productUrl);
        meta('og:site_name', 'Fashion Shop');
        meta('og:locale', 'en_US');
        
        const tw = (name, val) => {
          const m = document.createElement('meta');
          m.setAttribute('name', name);
          m.setAttribute('content', String(val));
          m.setAttribute('data-dynamic-tag', 'true');
          document.head.appendChild(m);
        };
        tw('twitter:card', 'summary_large_image');
        tw('twitter:title', title);
        tw('twitter:description', desc);
        tw('twitter:image', image);
        
        if (pageType === 'product') {
          meta('product:price:amount', Number(product.price).toFixed(2));
          meta('product:price:currency', 'EUR');
          meta('product:availability', Number(product.quantity) > 0 ? 'in stock' : 'out of stock');
          meta('product:condition', 'new');
          meta('product:brand', product.brand);
          meta('product:retailer_item_id', product.sku);
          meta('product:item_group_id', product.id);
          meta('product:color', product.color);
          meta('product:size', product.size);
          meta('product:gender', product.gender);
        }
      }
      
      function ga4Item(p, index = 0) {
        return {
          item_id: p.sku,
          item_name: p.name,
          item_brand: p.brand,
          item_category: p.category_1,
          item_category2: p.category_2,
          item_variant: p.variant,
          price: Number(p.price),
          quantity: 1,
          index
        };
      }
      
      function nonstandardItem(p, index = 0) {
        const std = ga4Item(p, index);
        const out = {};
        const map = window.__nonstandardFieldMap.itemFields;
        for (const [k, v] of Object.entries(std)) {
          const mapped = map[k] || k;
          out[mapped] = v;
        }
        return out;
      }
      
      function partialItem(p) {
        return {
          item_id: p.sku,
          item_name: p.name,
          price: Number(p.price),
          quantity: 1
        };
      }
      
      function ceddlProduct(p) {
        return {
          productInfo: {
            productID: p.sku,
            productName: p.name,
            manufacturer: p.brand,
            productURL: window.__siteUrl + '/product/' + encodeURIComponent(p.sku) + '.html',
            sku: p.sku,
            [gtinKey(p.gtin)]: p.gtin,
            mpn: p.mpn
          },
          category: {
            primaryCategory: p.category_1,
            subCategory1: p.category_2
          },
          attributes: {
            variant: p.variant,
            color: p.color,
            size: p.size,
            material: p.material,
            gender: p.gender
          },
          price: {
            basePrice: Number(p.price),
            currency: 'EUR'
          },
          linkedProduct: []
        };
      }
      
      function injectDataLayer(mode) {
        window.dataLayer = window.dataLayer || [];
        if (mode === 'suppress') return;
        
        const pageType = window.__pageType;
        const product = window.__productData;
        const listProducts = window.__listProducts;
        
        if (mode === 'ga4') {
          window.dataLayer.push({ event: 'page_view', page_type: pageType });
          if (pageType === 'product') {
            window.dataLayer.push({
              event: 'view_item',
              ecommerce: {
                currency: 'EUR',
                value: product.price,
                items: [ga4Item(product, 0)]
              }
            });
          } else if (pageType === 'category' || pageType === 'homepage') {
            const items = listProducts.slice(0, 8).map((p, i) => ga4Item(p, i));
            window.dataLayer.push({
              event: 'view_item_list',
              ecommerce: {
                item_list_name: pageType === 'homepage' ? 'Featured Products' : product.category_1,
                item_list_id: pageType === 'homepage' ? 'homepage' : product.category_1.toLowerCase(),
                items: items
              }
            });
          }
        }
        
        if (mode === 'nonstandard') {
          const em = window.__nonstandardFieldMap.events;
          const ef = window.__nonstandardFieldMap.ecommerceFields;
          window.dataLayer.push({ eventName: em.page_view, pageType: pageType });
          if (pageType === 'product') {
            window.dataLayer.push({
              eventName: em.view_item,
              commerce: {
                [ef.currency]: 'EUR',
                [ef.value]: product.price,
                [ef.items]: [nonstandardItem(product, 0)]
              }
            });
          } else if (pageType === 'category' || pageType === 'homepage') {
            const items = listProducts.slice(0, 8).map((p, i) => nonstandardItem(p, i));
            window.dataLayer.push({
              eventName: em.view_item_list,
              commerce: {
                listName: pageType === 'homepage' ? 'Featured' : product.category_1,
                [ef.items]: items
              }
            });
          }
        }
        
        if (mode === 'partial') {
          window.dataLayer.push({ event: 'page_view', page_type: pageType });
          if (pageType === 'product') {
            window.dataLayer.push({
              event: 'view_item',
              ecommerce: {
                items: [partialItem(product)]
              }
            });
          } else if (pageType === 'category' || pageType === 'homepage') {
            const items = listProducts.slice(0, 4).map(p => partialItem(p));
            window.dataLayer.push({
              event: 'view_item_list',
              ecommerce: {
                items: items
              }
            });
          }
        }
        
        if (mode === 'ceddl') {
          const digitalData = {
            pageInstanceID: pageType + '-' + (product.sku || 'home'),
            page: {
              pageInfo: { pageID: pageType, pageName: pageType === 'product' ? product.name : product.category_1 },
              category: { primaryCategory: pageType }
            },
            product: pageType === 'product' ? [ceddlProduct(product)] : [],
            cart: {},
            transaction: {},
            user: []
          };
          window.digitalData = digitalData;
          window.dataLayer.push({ event: 'page_view', page_type: pageType });
        }
      }
      
      function publishExpectedSignals() {
        const product = window.__productData;
        const pageType = window.__pageType;
        
        if (pageType !== 'product') {
          window.__expectedSignals = { pageType, activeConfig: activeCfg };
          return;
        }
        
        const canonical = {
          productId: product.sku,
          productName: product.name,
          brand: product.brand,
          price: String(product.price),
          currency: 'EUR',
          category: product.category_1,
          availability: Number(product.quantity) > 0 ? 'InStock' : 'OutOfStock',
          image: absUrl(product.image),
          description: product.description,
          gtin: product.gtin,
          color: product.color,
          size: product.size,
          gender: product.gender,
          rating: product.rating_value,
          ratingCount: product.rating_count
        };
        
        const expectedFields = [];
        
        if (activeCfg.dataLayer === 'ga4' || activeCfg.dataLayer === 'partial') {
          expectedFields.push('productId', 'productName', 'price');
          if (activeCfg.dataLayer === 'ga4') {
            expectedFields.push('brand', 'category', 'color');
          }
        } else if (activeCfg.dataLayer === 'nonstandard') {
          expectedFields.push('productId', 'productName', 'price', 'brand', 'category');
        } else if (activeCfg.dataLayer === 'ceddl') {
          expectedFields.push('productId', 'productName', 'brand', 'price', 'currency', 'category', 'color', 'size', 'gender');
        }
        
        if (activeCfg.jsonLd === 'full' || activeCfg.jsonLd === 'no-price' || activeCfg.jsonLd === 'minimal') {
          expectedFields.push('productId', 'productName');
          if (activeCfg.jsonLd !== 'minimal') {
            expectedFields.push('brand', 'category', 'description', 'image', 'color', 'size', 'gender', 'rating', 'ratingCount');
            if (activeCfg.jsonLd === 'full') {
              expectedFields.push('price', 'currency', 'availability');
            }
          }
        }
        
        if (activeCfg.openGraph === 'full' || activeCfg.openGraph === 'price-only' || activeCfg.openGraph === 'minimal') {
          expectedFields.push('productName');
          if (activeCfg.openGraph === 'price-only') {
            expectedFields.push('price', 'currency', 'availability');
          } else if (activeCfg.openGraph === 'minimal') {
            expectedFields.push('description');
          } else if (activeCfg.openGraph === 'full') {
            expectedFields.push('productId', 'brand', 'price', 'currency', 'availability', 'image', 'description', 'color', 'size', 'gender');
          }
        }
        
        const uniqueFields = [...new Set(expectedFields)].filter(f => canonical[f] !== undefined && canonical[f] !== '');
        
        window.__expectedSignals = {
          pageType,
          activeConfig: activeCfg,
          canonical,
          expectedFields: uniqueFields
        };
      }
      
      if (hasOverrides) {
        cleanStaticTags();
        injectJsonLd(activeCfg.jsonLd);
        injectOpenGraph(activeCfg.openGraph);
        injectDataLayer(activeCfg.dataLayer);
      }
      
      publishExpectedSignals();
    })();
  </script>
  
  <!-- Google Tag Manager -->
  <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
  new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
  j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
  'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
  })(window,document,'script','dataLayer','GTM_CONTAINER_ID');</script>
  <!-- End Google Tag Manager -->
  <style>
    body{font-family:system-ui,sans-serif;max-width:1000px;margin:0 auto;padding:1rem;color:#222}
    header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #ddd;padding-bottom:.5rem;margin-bottom:1rem}
    .variant-badge{background:#f0f0f0;border:1px solid #ccc;border-radius:4px;padding:.25rem .5rem;font-size:.75rem;font-family:monospace}
    .product img{max-width:300px;border-radius:8px}
    .product dl{display:grid;grid-template-columns:auto 1fr;gap:.25rem .75rem;font-size:.875rem}
    .product dt{font-weight:600;color:#555}
    .product-grid{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:1rem}
    .card a{text-decoration:none;color:inherit}
    .card img{width:100%;border-radius:4px}
    footer{margin-top:2rem;padding-top:1rem;border-top:1px solid #ddd;font-size:.75rem;color:#777}
  </style>
</head>
<body>
  <!-- Google Tag Manager (noscript) -->
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM_CONTAINER_ID"
  height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
  <!-- End Google Tag Manager (noscript) -->
  <div style="background: linear-gradient(90deg, #d4af37, #b5952f); color: #111; text-align: center; padding: 10px 20px; font-size: 13px; font-weight: 700; border-bottom: 2px solid #997c23; letter-spacing: 0.5px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; gap: 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <span>⚠️</span> <strong>TESTING PLATFORM:</strong> This is a synthetic, mock e-commerce sandbox for automated tag and schema verification. No real products, payments, or deliveries are offered or processed.
  </div>
  ${dlBlock}
  <header>
    <a href="/${variant.id}/">← ${variant.id} home</a>
    <nav>
      <a href="/variants.html">All Variants</a>
    </nav>
    <span class="variant-badge" title="${esc(variant.description)}">${esc(variant.id)}: ${esc(variant.label)}</span>
  </header>
  <main>${bodyContent}
  </main>
  <footer>
    <p><strong>Variant ${esc(variant.id)}:</strong> ${esc(variant.description)}</p>
    <p>Active data sources: <code>${esc(dataBadge(variant))}</code></p>
  </footer>
  
  <!-- Interactive Tag & Schema Inspector Floating Console -->
  <style>
    #tag-inspector-fab {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background: #1a1a1a;
      border: 1.5px solid #d4af37;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      cursor: pointer;
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #d4af37;
      font-size: 22px;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }
    #tag-inspector-fab:hover {
      transform: scale(1.08) rotate(15deg);
      box-shadow: 0 6px 20px rgba(212, 175, 55, 0.4);
    }
    #tag-inspector-panel {
      position: fixed;
      bottom: 85px;
      right: 20px;
      width: 380px;
      max-height: 80vh;
      border-radius: 12px;
      background: rgba(20, 20, 20, 0.92);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(212, 175, 55, 0.25);
      box-shadow: 0 10px 30px rgba(0,0,0,0.6);
      z-index: 999999;
      color: #e2e2e2;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: none;
      flex-direction: column;
      overflow: hidden;
      opacity: 0;
      transform: translateY(15px) scale(0.97);
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }
    #tag-inspector-panel.open {
      display: flex;
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    .ti-header {
      background: rgba(0, 0, 0, 0.4);
      padding: 10px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .ti-header h3 {
      margin: 0;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #d4af37;
      font-weight: 700;
    }
    .ti-close {
      background: none;
      border: none;
      color: #999;
      font-size: 16px;
      cursor: pointer;
      transition: color 0.2s;
    }
    .ti-close:hover { color: #fff; }
    .ti-content {
      padding: 14px;
      overflow-y: auto;
      flex: 1;
      font-size: 12px;
    }
    .ti-section {
      margin-bottom: 12px;
    }
    .ti-label {
      display: block;
      font-size: 10px;
      text-transform: uppercase;
      color: #999;
      margin-bottom: 4px;
      letter-spacing: 0.5px;
    }
    .ti-select {
      width: 100%;
      background: #252525;
      border: 1px solid rgba(255,255,255,0.12);
      color: #fff;
      padding: 6px 8px;
      border-radius: 6px;
      font-size: 12px;
      outline: none;
      cursor: pointer;
      transition: border-color 0.2s;
    }
    .ti-select:focus { border-color: #d4af37; }
    .ti-tabs {
      display: flex;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      background: rgba(0, 0, 0, 0.2);
      margin: 0 -14px 10px -14px;
    }
    .ti-tab {
      flex: 1;
      text-align: center;
      padding: 8px 0;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      color: #999;
      font-weight: 600;
      font-size: 11px;
      transition: all 0.2s;
    }
    .ti-tab.active {
      color: #d4af37;
      border-color: #d4af37;
      background: rgba(212, 175, 55, 0.05);
    }
    .ti-pane { display: none; }
    .ti-pane.active { display: block; }
    .ti-code-block {
      background: #0d0d0d;
      border: 1px solid rgba(255,255,255,0.04);
      border-radius: 6px;
      padding: 8px;
      font-family: monospace;
      font-size: 10.5px;
      color: #4af626;
      overflow-x: auto;
      max-height: 160px;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .ti-btn-row {
      display: flex;
      gap: 6px;
      margin-top: 8px;
    }
    .ti-btn {
      flex: 1;
      padding: 6px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      transition: all 0.2s;
    }
    .ti-btn-save { background: #d4af37; color: #111; }
    .ti-btn-save:hover { background: #bca035; }
    .ti-btn-reset { background: rgba(255,255,255,0.1); color: #fff; }
    .ti-btn-reset:hover { background: rgba(255,255,255,0.15); }
    .ti-badge-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 4px;
    }
    .ti-badge {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 3px 6px;
      background: rgba(255,255,255,0.04);
      border-radius: 4px;
      font-size: 10.5px;
    }
    .ti-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
    }
    .ti-dot-green { background: #00ff66; box-shadow: 0 0 6px #00ff66; }
    .ti-dot-red { background: #ff3333; box-shadow: 0 0 6px #ff3333; }
  </style>
  
  <div id="tag-inspector-fab" onclick="toggleInspectorPanel()">🏷️</div>
  <div id="tag-inspector-panel">
    <div class="ti-header">
      <h3>🛡️ Tag & Schema Inspector</h3>
      <button class="ti-close" onclick="toggleInspectorPanel()">✕</button>
    </div>
    <div class="ti-content">
      <div class="ti-section">
        <label class="ti-label">Active Variant Template</label>
        <select class="ti-select" id="ti-variant-select" onchange="handleVariantSelect()">
          <!-- Populated in JS -->
        </select>
      </div>
      
      <div class="ti-section">
        <label class="ti-label">Granular Core Overrides</label>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;">
          <div>
            <span style="font-size:9.5px;color:#888;">DataLayer</span>
            <select class="ti-select" id="ti-dl-select">
              <option value="ga4">GA4</option>
              <option value="suppress">Suppress</option>
              <option value="nonstandard">Custom</option>
              <option value="ceddl">CEDDL</option>
              <option value="partial">Partial</option>
            </select>
          </div>
          <div>
            <span style="font-size:9.5px;color:#888;">JSON-LD</span>
            <select class="ti-select" id="ti-jld-select">
              <option value="full">Full</option>
              <option value="no-price">No Price</option>
              <option value="minimal">Minimal</option>
              <option value="false">None</option>
            </select>
          </div>
          <div>
            <span style="font-size:9.5px;color:#888;">OpenGraph</span>
            <select class="ti-select" id="ti-og-select">
              <option value="full">Full</option>
              <option value="price-only">Price Only</option>
              <option value="minimal">Minimal</option>
              <option value="false">None</option>
            </select>
          </div>
        </div>
        <div class="ti-btn-row">
          <button class="ti-btn ti-btn-save" onclick="applyInspectorOverrides()">Apply Overrides</button>
          <button class="ti-btn ti-btn-reset" onclick="resetInspectorOverrides()">Reset</button>
        </div>
      </div>
      
      <div class="ti-tabs">
        <div class="ti-tab active" onclick="switchInspectorTab(0)">dataLayer</div>
        <div class="ti-tab" onclick="switchInspectorTab(1)">JSON-LD</div>
        <div class="ti-tab" onclick="switchInspectorTab(2)">OpenGraph</div>
        <div class="ti-tab" onclick="switchInspectorTab(3)">Oracle</div>
      </div>
      
      <div class="ti-pane active" id="ti-pane-dl">
        <div class="ti-code-block" id="ti-code-dl">Loading dataLayer...</div>
      </div>
      <div class="ti-pane" id="ti-pane-jld">
        <div class="ti-code-block" id="ti-code-jld">Loading JSON-LD...</div>
      </div>
      <div class="ti-pane" id="ti-pane-og">
        <div class="ti-code-block" id="ti-code-og">Loading OpenGraph...</div>
      </div>
      <div class="ti-pane" id="ti-pane-oracle">
        <div class="ti-section" style="margin-bottom:6px;">
          <span style="font-size:10px;color:#999;display:block;margin-bottom:4px;">Expected Entity Scrape Checklist:</span>
          <div class="ti-badge-grid" id="ti-oracle-badges">
            <!-- Populated dynamically -->
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <script>
    function handleAddToCartClick() {
      const mode = window.__resolvedConfig.dataLayer;
      if (mode === 'suppress') {
        alert('DataLayer is suppressed under active configuration.');
        return;
      }
      
      const product = window.__productData;
      
      if (mode === 'ga4') {
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ ecommerce: null });
        window.dataLayer.push({
          event: 'add_to_cart',
          ecommerce: {
            currency: 'EUR',
            value: Number(product.price),
            items: [{
              item_id: product.sku,
              item_name: product.name,
              item_brand: product.brand,
              item_category: product.category_1,
              item_category2: product.category_2,
              item_variant: product.variant,
              price: Number(product.price),
              quantity: 1,
              index: 1
            }]
          }
        });
        alert('Event "add_to_cart" pushed to dataLayer!');
      }
      
      if (mode === 'nonstandard') {
        window.dataLayer = window.dataLayer || [];
        const em = window.__nonstandardFieldMap.events;
        const ef = window.__nonstandardFieldMap.ecommerceFields;
        const std = {
          item_id: product.sku,
          item_name: product.name,
          item_brand: product.brand,
          item_category: product.category_1,
          item_category2: product.category_2,
          item_variant: product.variant,
          price: Number(product.price),
          quantity: 1,
          index: 1
        };
        const mappedItem = {};
        const map = window.__nonstandardFieldMap.itemFields;
        for (const [k, v] of Object.entries(std)) {
          const mapped = map[k] || k;
          mappedItem[mapped] = v;
        }
        window.dataLayer.push({
          event: em.add_to_cart,
          commerce: {
            [ef.currency]: 'EUR',
            [ef.value]: Number(product.price),
            [ef.items]: [mappedItem]
          }
        });
        alert('Event "' + em.add_to_cart + '" pushed to dataLayer!');
      }
      
      if (mode === 'partial') {
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ ecommerce: null });
        window.dataLayer.push({
          event: 'add_to_cart',
          ecommerce: {
            items: [{
              item_id: product.sku,
              item_name: product.name,
              price: Number(product.price),
              quantity: 1
            }]
          }
        });
        alert('Partial event "add_to_cart" pushed to dataLayer!');
      }
      
      if (mode === 'ceddl') {
        window.digitalData = window.digitalData || {};
        window.digitalData.cart = window.digitalData.cart || { item: [] };
        
        const ceddlProduct = (p) => ({
          productInfo: {
            productID: p.sku,
            productName: p.name,
            manufacturer: p.brand,
            sku: p.sku
          },
          category: {
            primaryCategory: p.category_1,
            subCategory1: p.category_2
          },
          attributes: {
            variant: p.variant,
            color: p.color,
            size: p.size,
            gender: p.gender
          },
          price: {
            basePrice: Number(p.price),
            currency: 'EUR'
          }
        });
        
        window.digitalData.cart.item.push({
          productInfo: ceddlProduct(product).productInfo,
          quantity: 1,
          price: ceddlProduct(product).price
        });
        
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ event: 'cart_add', page_type: 'product' });
        alert('Event "cart_add" pushed to dataLayer & CEDDL digitalData.cart updated!');
      }
      
      if (typeof updateInspectorViews === 'function') {
        updateInspectorViews();
      }
    }

    function toggleInspectorPanel() {
      const p = document.getElementById('tag-inspector-panel');
      p.classList.toggle('open');
      if (p.classList.contains('open')) {
        updateInspectorViews();
      }
    }
    
    function switchInspectorTab(idx) {
      const tabs = document.querySelectorAll('.ti-tab');
      const panes = document.querySelectorAll('.ti-pane');
      tabs.forEach((t, i) => t.classList.toggle('active', i === idx));
      panes.forEach((p, i) => p.classList.toggle('active', i === idx));
    }
    
    function populateVariantDropdown() {
      const sel = document.getElementById('ti-variant-select');
      sel.innerHTML = '';
      window.__variants.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.id + ': ' + v.label;
        opt.selected = v.id === window.__resolvedConfig.id;
        sel.appendChild(opt);
      });
      
      document.getElementById('ti-dl-select').value = String(window.__resolvedConfig.dataLayer || 'suppress');
      document.getElementById('ti-jld-select').value = String(window.__resolvedConfig.jsonLd || 'false');
      document.getElementById('ti-og-select').value = String(window.__resolvedConfig.openGraph || 'false');
    }
    
    function handleVariantSelect() {
      const varId = document.getElementById('ti-variant-select').value;
      const v = window.__variants.find(x => x.id === varId);
      if (v) {
        document.getElementById('ti-dl-select').value = String(v.dataLayer || 'suppress');
        document.getElementById('ti-jld-select').value = String(v.jsonLd || 'false');
        document.getElementById('ti-og-select').value = String(v.openGraph || 'false');
      }
    }
    
    function applyInspectorOverrides() {
      const varId = document.getElementById('ti-variant-select').value;
      const dl = document.getElementById('ti-dl-select').value;
      const jld = document.getElementById('ti-jld-select').value;
      const og = document.getElementById('ti-og-select').value;
      
      sessionStorage.setItem('active_test_variant', varId);
      sessionStorage.setItem('override_dataLayer', dl);
      sessionStorage.setItem('override_jsonLd', jld);
      sessionStorage.setItem('override_openGraph', og);
      
      const curPath = window.location.pathname;
      const pathParts = curPath.split('/');
      if (pathParts[1] && pathParts[1].startsWith('c')) {
        pathParts[1] = varId;
        window.location.href = pathParts.join('/') + window.location.search;
      } else {
        window.location.reload();
      }
    }
    
    function resetInspectorOverrides() {
      sessionStorage.removeItem('active_test_variant');
      sessionStorage.removeItem('override_dataLayer');
      sessionStorage.removeItem('override_jsonLd');
      sessionStorage.removeItem('override_openGraph');
      window.location.reload();
    }
    
    function updateInspectorViews() {
      const dlCode = document.getElementById('ti-code-dl');
      dlCode.textContent = JSON.stringify(window.dataLayer || [], null, 2);
      
      const jldCode = document.getElementById('ti-code-jld');
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      const jldList = [];
      scripts.forEach(s => {
        try { jldList.push(JSON.parse(s.textContent)); } catch(e) {}
      });
      jldCode.textContent = jldList.length ? JSON.stringify(jldList, null, 2) : '// No active JSON-LD scripts found.';
      
      const ogCode = document.getElementById('ti-code-og');
      const ogMap = {};
      document.querySelectorAll('meta[property^="og:"], meta[property^="product:"], meta[name^="twitter:"]').forEach(m => {
        const prop = m.getAttribute('property') || m.getAttribute('name');
        ogMap[prop] = m.getAttribute('content');
      });
      ogCode.textContent = Object.keys(ogMap).length ? JSON.stringify(ogMap, null, 2) : '// No active OpenGraph tags found.';
      
      const badgeContainer = document.getElementById('ti-oracle-badges');
      badgeContainer.innerHTML = '';
      if (window.__expectedSignals && window.__expectedSignals.canonical) {
        const oracle = window.__expectedSignals;
        const allTargetFields = [
          'productId', 'productName', 'brand', 'price', 'currency', 'category', 'availability', 'image', 'description'
        ];
        
        allTargetFields.forEach(f => {
          const isExpected = oracle.expectedFields.includes(f);
          const badge = document.createElement('div');
          badge.className = 'ti-badge';
          const dot = document.createElement('span');
          dot.className = 'ti-dot ' + (isExpected ? 'ti-dot-green' : 'ti-dot-red');
          badge.appendChild(dot);
          badge.appendChild(document.createTextNode(f));
          badgeContainer.appendChild(badge);
        });
      } else {
        badgeContainer.innerHTML = '<span style="color:#888;">Test Oracle only active on product pages.</span>';
      }
    }
    
    populateVariantDropdown();
  </script>
</body>
</html>`;
}

// ─── VARIANTS INDEX PAGE ──────────────────────────────────────────────────────

function generateVariantsIndex(variants, product) {
  const rows = variants.map(v => `
    <tr>
      <td><strong>${esc(v.id)}</strong></td>
      <td>${esc(v.label)}</td>
      <td><code>${esc(v.dataLayer || '—')}</code></td>
      <td><code>${esc(v.jsonLd || '—')}</code></td>
      <td><code>${esc(v.openGraph || '—')}</code></td>
      <td>
        <a href="/${v.id}/">home</a> ·
        <a href="/${v.id}/product/${encodeURIComponent(product.sku)}.html">product</a> ·
        <a href="/${v.id}/category/apparel.html">category</a>
      </td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Variants — Fashion Shop</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:1100px;margin:0 auto;padding:1rem}
    table{width:100%;border-collapse:collapse}
    th,td{text-align:left;padding:.5rem;border-bottom:1px solid #ddd;font-size:.875rem}
    th{background:#f5f5f5;font-weight:600}
    code{background:#f0f0f0;padding:.1rem .3rem;border-radius:3px;font-size:.8rem}
    a{color:#0066cc}
  </style>
</head>
<body>
  <h1>Structured-Data Test Variants</h1>
  <p>Each variant tests a different combination of DataLayer, JSON-LD, and OpenGraph signals.</p>
  <table>
    <thead>
      <tr><th>ID</th><th>Label</th><th>DataLayer</th><th>JSON-LD</th><th>OpenGraph</th><th>Pages</th></tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>
  <p style="margin-top:2rem;font-size:.8rem;color:#777">
    Run <code>cd tests && npm test</code> to generate the gap report.
    Run <code>cd tests && npm run automap</code> to generate JQ mappings.
  </p>
</body>
</html>`;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

function main() {
  const products = parseCatalog();

  // Representative products for testing
  const PRODUCT_APPAREL = products.find(p => p.sku === 'TSHIRT-001-RED-M');
  const PRODUCT_FOOTWEAR = products.find(p => p.sku === 'SHOE-003-WHT-42');
  const PRODUCT_ACCESSORIES = products.find(p => p.sku === 'ACC-004-GLD');

  for (const variant of VARIANTS) {
    const varDir = path.join(DIST, variant.id);

    // Homepage
    const homePage = generatePage(variant, 'homepage', PRODUCT_APPAREL, products);
    fs.mkdirSync(varDir, { recursive: true });
    fs.writeFileSync(path.join(varDir, 'index.html'), homePage);

    // Product pages
    for (const product of [PRODUCT_APPAREL, PRODUCT_FOOTWEAR, PRODUCT_ACCESSORIES]) {
      const productPage = generatePage(variant, 'product', product, products);
      const productDir = path.join(varDir, 'product');
      fs.mkdirSync(productDir, { recursive: true });
      fs.writeFileSync(path.join(productDir, `${product.sku}.html`), productPage);
    }

    // Category pages
    for (const cat of ['Apparel', 'Footwear', 'Accessories']) {
      const representative = products.find(p => p.category_1 === cat);
      const categoryPage = generatePage(variant, 'category', representative, products);
      const catDir = path.join(varDir, 'category');
      fs.mkdirSync(catDir, { recursive: true });
      fs.writeFileSync(path.join(catDir, `${cat.toLowerCase()}.html`), categoryPage);
    }

    console.log(`✓ ${variant.id}: ${variant.label}`);
  }

  // Variants index
  fs.writeFileSync(path.join(DIST, 'variants.html'), generateVariantsIndex(VARIANTS, PRODUCT_APPAREL));
  console.log('✓ variants.html');

  console.log(`\nGenerated ${VARIANTS.length * (1 + 3 + 3) + 1} pages into dist/`);
}

main();
