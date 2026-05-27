/**
 * AutoMapper
 *
 * Reads the gap report produced by the test matrix and generates JQ expressions
 * for each field × source combination. Also runs drift detection: compares
 * current gap report against a stored baseline and flags changes.
 *
 * Outputs:
 *   - automapper/mappings/{variantId}.json   — JQ mappings per variant
 *   - automapper/baselines/{variantId}.json  — snapshot used for drift detection
 *   - automapper/reports/drift-report.json   — drift summary (if --drift flag set)
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface GapEntry {
  variant: string;
  pageType: string;
  url: string;
  presentFields: Record<string, { source: string; value: unknown }>;
  missingFields: string[];
  activeSources: string[];
}

export interface FieldMapping {
  field: string;
  source: string;
  jq: string;
  notes?: string;
}

export interface VariantMappings {
  variant: string;
  generatedAt: string;
  activeSources: string[];
  mappings: FieldMapping[];
  unmappableFields: { field: string; reason: string }[];
}

export interface DriftEvent {
  variant: string;
  field: string;
  previousSource: string;
  currentSource: string | null;
  type: 'field_source_changed' | 'field_disappeared' | 'field_appeared';
}

// ─── JQ TEMPLATE LIBRARY ─────────────────────────────────────────────────────
// Each template is a function(fieldValue) that returns a JQ expression.
// We generate based on which source the field was found in.

const JQ_TEMPLATES: Record<string, Record<string, string>> = {
  productId: {
    'dataLayer':             '.dataLayer // [] | map(select(.event == "view_item")) | first | .ecommerce.items[0].item_id // empty',
    'dataLayer(nonstandard)':'.dataLayer // [] | map(select(.eventName == "productDetailView")) | first | .commerce.products[0].productId // empty',
    'jsonLd':                '.jsonLd // [] | map(select(."@type" == "Product")) | first | .sku // empty',
    'openGraph':             '.openGraph["product:retailer_item_id"] // empty',
    'ceddl':                 '.digitalData.product[0].productInfo.productID // empty',
  },
  productName: {
    'dataLayer':             '.dataLayer // [] | map(select(.event == "view_item")) | first | .ecommerce.items[0].item_name // empty',
    'dataLayer(nonstandard)':'.dataLayer // [] | map(select(.eventName == "productDetailView")) | first | .commerce.products[0].productName // empty',
    'jsonLd':                '.jsonLd // [] | map(select(."@type" == "Product")) | first | .name // empty',
    'openGraph':             '.openGraph["og:title"] // empty',
    'ceddl':                 '.digitalData.product[0].productInfo.productName // empty',
  },
  brand: {
    'dataLayer':             '.dataLayer // [] | map(select(.event == "view_item")) | first | .ecommerce.items[0].item_brand // empty',
    'dataLayer(nonstandard)':'.dataLayer // [] | map(select(.eventName == "productDetailView")) | first | .commerce.products[0].brand // empty',
    'jsonLd':                '.jsonLd // [] | map(select(."@type" == "Product")) | first | .brand.name // .brand // empty',
    'openGraph':             '.openGraph["product:brand"] // empty',
    'ceddl':                 '.digitalData.product[0].productInfo.manufacturer // empty',
  },
  price: {
    'dataLayer':             '.dataLayer // [] | map(select(.event == "view_item")) | first | .ecommerce.items[0].price // empty',
    'dataLayer(nonstandard)':'.dataLayer // [] | map(select(.eventName == "productDetailView")) | first | .commerce.products[0].unitPrice // empty',
    'jsonLd':                '.jsonLd // [] | map(select(."@type" == "Product")) | first | .offers.price // empty',
    'openGraph':             '.openGraph["product:price:amount"] // empty',
    'ceddl':                 '.digitalData.product[0].price.basePrice // empty',
  },
  currency: {
    'dataLayer':             '.dataLayer // [] | map(select(.event == "view_item")) | first | .ecommerce.currency // empty',
    'dataLayer(nonstandard)':'.dataLayer // [] | map(select(.eventName == "productDetailView")) | first | .commerce.currencyCode // empty',
    'jsonLd':                '.jsonLd // [] | map(select(."@type" == "Product")) | first | .offers.priceCurrency // empty',
    'openGraph':             '.openGraph["product:price:currency"] // empty',
    'ceddl':                 '.digitalData.product[0].price.currency // empty',
  },
  category: {
    'dataLayer':             '.dataLayer // [] | map(select(.event == "view_item")) | first | .ecommerce.items[0].item_category // empty',
    'dataLayer(nonstandard)':'.dataLayer // [] | map(select(.eventName == "productDetailView")) | first | .commerce.products[0].category // empty',
    'jsonLd':                '.jsonLd // [] | map(select(."@type" == "Product")) | first | .category // empty',
    'ceddl':                 '.digitalData.product[0].category.primaryCategory // empty',
  },
  availability: {
    'jsonLd':                '.jsonLd // [] | map(select(."@type" == "Product")) | first | .offers.availability | ltrimstr("https://schema.org/") // empty',
    'openGraph':             '.openGraph["product:availability"] // empty',
  },
  image: {
    'jsonLd':                '.jsonLd // [] | map(select(."@type" == "Product")) | first | .image[0] // .image // empty',
    'openGraph':             '.openGraph["og:image"] // empty',
  },
  description: {
    'jsonLd':                '.jsonLd // [] | map(select(."@type" == "Product")) | first | .description // empty',
    'openGraph':             '.openGraph["og:description"] // empty',
  },
  gtin: {
    'jsonLd':                '.jsonLd // [] | map(select(."@type" == "Product")) | first | (.gtin13 // .gtin14 // .gtin12 // .gtin8 // .gtin) // empty',
  },
  color: {
    'dataLayer':             '.dataLayer // [] | map(select(.event == "view_item")) | first | .ecommerce.items[0].item_variant // empty',
    'jsonLd':                '.jsonLd // [] | map(select(."@type" == "Product")) | first | .color // empty',
    'openGraph':             '.openGraph["product:color"] // empty',
    'ceddl':                 '.digitalData.product[0].attributes.color // empty',
  },
  size: {
    'jsonLd':                '.jsonLd // [] | map(select(."@type" == "Product")) | first | .size // empty',
    'openGraph':             '.openGraph["product:size"] // empty',
    'ceddl':                 '.digitalData.product[0].attributes.size // empty',
  },
  gender: {
    'jsonLd':                '.jsonLd // [] | map(select(."@type" == "Product")) | first | .audience.suggestedGender // empty',
    'openGraph':             '.openGraph["product:gender"] // empty',
    'ceddl':                 '.digitalData.product[0].attributes.gender // empty',
  },
  rating: {
    'jsonLd':                '.jsonLd // [] | map(select(."@type" == "Product")) | first | .aggregateRating.ratingValue // empty',
  },
  ratingCount: {
    'jsonLd':                '.jsonLd // [] | map(select(."@type" == "Product")) | first | .aggregateRating.reviewCount // empty',
  },
};

// Fields that require richer data the page doesn't emit — can't be auto-mapped
const STRUCTURALLY_UNMAPPABLE: Partial<Record<string, string>> = {
  rating:      'Only available via JSON-LD aggregateRating — add JSON-LD with aggregateRating to include this field',
  ratingCount: 'Only available via JSON-LD aggregateRating — add JSON-LD with aggregateRating to include this field',
  gtin:        'Only available via JSON-LD gtin* fields — add JSON-LD Product schema to include this field',
};

// ─── CORE FUNCTIONS ───────────────────────────────────────────────────────────

export function generateMappingsForVariant(entries: GapEntry[]): VariantMappings {
  const variant = entries[0].variant;
  const activeSources = [...new Set(entries.flatMap(e => e.activeSources))];

  const mappings: FieldMapping[] = [];
  const unmappableFields: { field: string; reason: string }[] = [];
  const processedFields = new Set<string>();

  // For each field that appears in any entry's presentFields, generate a mapping
  for (const entry of entries) {
    for (const [field, { source }] of Object.entries(entry.presentFields)) {
      if (processedFields.has(field)) continue;
      processedFields.add(field);

      const jq = JQ_TEMPLATES[field]?.[source];
      if (jq) {
        mappings.push({ field, source, jq });
      } else {
        // No template for this source — generate a best-effort mapping
        mappings.push({
          field,
          source,
          jq: `# No template for ${field} from ${source} — manual mapping required`,
          notes: `Value observed: ${JSON.stringify(entry.presentFields[field].value)}`,
        });
      }
    }
  }

  // For fields that were missing everywhere, record why
  const allMissing = [...new Set(entries.flatMap(e => e.missingFields))];
  for (const field of allMissing) {
    if (processedFields.has(field)) continue; // found in another page type

    if (STRUCTURALLY_UNMAPPABLE[field]) {
      unmappableFields.push({ field, reason: STRUCTURALLY_UNMAPPABLE[field]! });
    } else {
      unmappableFields.push({
        field,
        reason: `Field not present in any active source (${activeSources.join(', ')}) for this variant`,
      });
    }
  }

  return {
    variant,
    generatedAt: new Date().toISOString(),
    activeSources,
    mappings,
    unmappableFields,
  };
}

// ─── DRIFT DETECTION ─────────────────────────────────────────────────────────

export function detectDrift(
  baseline: VariantMappings,
  current: VariantMappings,
): DriftEvent[] {
  const events: DriftEvent[] = [];

  const baselineMap = new Map(baseline.mappings.map(m => [m.field, m.source]));
  const currentMap  = new Map(current.mappings.map(m => [m.field, m.source]));

  for (const [field, baseSource] of baselineMap) {
    if (!currentMap.has(field)) {
      events.push({ variant: current.variant, field, previousSource: baseSource, currentSource: null, type: 'field_disappeared' });
    } else if (currentMap.get(field) !== baseSource) {
      events.push({ variant: current.variant, field, previousSource: baseSource, currentSource: currentMap.get(field)!, type: 'field_source_changed' });
    }
  }

  for (const [field, curSource] of currentMap) {
    if (!baselineMap.has(field)) {
      events.push({ variant: current.variant, field, previousSource: '', currentSource: curSource, type: 'field_appeared' });
    }
  }

  return events;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

export function run(opts: { drift?: boolean } = {}): void {
  const REPORTS_DIR  = path.join(__dirname, 'reports');
  const MAPPINGS_DIR = path.join(__dirname, 'mappings');
  const BASELINES_DIR = path.join(__dirname, 'baselines');

  const gapReportPath = path.join(REPORTS_DIR, 'gap-report.json');
  if (!fs.existsSync(gapReportPath)) {
    console.error('Gap report not found. Run `npm test` first.');
    process.exit(1);
  }

  const gapReport: GapEntry[] = JSON.parse(fs.readFileSync(gapReportPath, 'utf8'));
  const byVariant = new Map<string, GapEntry[]>();
  for (const entry of gapReport) {
    if (!byVariant.has(entry.variant)) byVariant.set(entry.variant, []);
    byVariant.get(entry.variant)!.push(entry);
  }

  fs.mkdirSync(MAPPINGS_DIR, { recursive: true });
  fs.mkdirSync(BASELINES_DIR, { recursive: true });

  const driftEvents: DriftEvent[] = [];

  for (const [variant, entries] of byVariant) {
    const variantMappings = generateMappingsForVariant(entries);
    const mappingPath = path.join(MAPPINGS_DIR, `${variant}.json`);

    if (opts.drift) {
      const baselinePath = path.join(BASELINES_DIR, `${variant}.json`);
      if (fs.existsSync(baselinePath)) {
        const baseline: VariantMappings = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
        const variantDrift = detectDrift(baseline, variantMappings);
        driftEvents.push(...variantDrift);
        if (variantDrift.length > 0) {
          console.log(`  ${variant}: ${variantDrift.length} drift event(s) detected`);
          for (const e of variantDrift) {
            console.log(`    [${e.type}] ${e.field}: ${e.previousSource} → ${e.currentSource ?? 'missing'}`);
          }
        }
      } else {
        console.log(`  ${variant}: no baseline yet — writing initial snapshot`);
      }
      // Always update baseline after drift run
      fs.writeFileSync(baselinePath, JSON.stringify(variantMappings, null, 2));
    }

    fs.writeFileSync(mappingPath, JSON.stringify(variantMappings, null, 2));

    const mappedCount = variantMappings.mappings.length;
    const unmappedCount = variantMappings.unmappableFields.length;
    console.log(`✓ ${variant}: ${mappedCount} field(s) mapped, ${unmappedCount} unmappable`);
    if (unmappedCount > 0) {
      console.log(`  Unmappable: ${variantMappings.unmappableFields.map(u => u.field).join(', ')}`);
    }
  }

  if (opts.drift && driftEvents.length > 0) {
    const driftReportPath = path.join(REPORTS_DIR, 'drift-report.json');
    fs.writeFileSync(driftReportPath, JSON.stringify({ generatedAt: new Date().toISOString(), events: driftEvents }, null, 2));
    console.log(`\nDrift report: ${driftReportPath}`);
    console.log(`Total drift events: ${driftEvents.length}`);

    // Exit with error code so CI can detect drift
    const critical = driftEvents.filter(e => e.type === 'field_disappeared');
    if (critical.length > 0) {
      console.error(`\n${critical.length} field(s) disappeared — mapping update required`);
      process.exitCode = 1;
    }
  }

  if (!opts.drift) {
    console.log(`\nMappings written to ${MAPPINGS_DIR}`);
    console.log('Run with --drift to compare against baselines and detect schema changes.');
  }
}
