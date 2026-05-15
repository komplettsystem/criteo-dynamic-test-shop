#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { VARIANTS, NONSTANDARD_FIELD_MAP } = require('./variant-configs');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const CATALOG_PATH = path.join(ROOT, 'catalog.csv');
const SITE_URL = 'https://peaceful-seahorse-9b0bb9.netlify.app';

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

  return `<script>
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
  return `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>`;
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
  return `<meta property="${esc(property)}" content="${esc(content)}">`;
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

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(titleStr)}</title>
  ${ogBlock ? ogBlock + '\n  ' : ''}
  ${jldBlock ? jldBlock + '\n  ' : ''}
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
