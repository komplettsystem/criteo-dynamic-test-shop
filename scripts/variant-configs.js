'use strict';

// Ten structured-data variant configurations.
// Each controls three independent axes: dataLayer, jsonLd, openGraph.
//
// dataLayer modes:
//   'ga4'          standard GA4 ecommerce events (item_id, item_name, …)
//   'suppress'     window.dataLayer exists but no ecommerce events are pushed
//   'nonstandard'  custom event names + field names (productId, unitPrice, …)
//   'ceddl'        CEDDL digitalData object pushed instead of GA4 events
//   'partial'      GA4 events but with key fields omitted (no brand, no currency)
//
// jsonLd modes:
//   'full'         Product + Offer + AggregateRating + BreadcrumbList / ItemList
//   'no-price'     Product with brand/sku/rating but NO Offers block
//   'minimal'      Product with name + url only
//   false          no JSON-LD at all
//
// openGraph modes:
//   'full'         og:* + product:* + twitter:*
//   'price-only'   product:price:amount + product:availability + og:title only
//   'minimal'      og:title + og:description + og:url only
//   false          no OG tags

const VARIANTS = [
  {
    id: 'c1',
    label: 'Full Canonical',
    description: 'DataLayer (GA4) + JSON-LD (full) + OpenGraph (full)',
    dataLayer: 'ga4',
    jsonLd: 'full',
    openGraph: 'full',
  },
  {
    id: 'c2',
    label: 'DataLayer Only',
    description: 'GA4 ecommerce events; no JSON-LD; no OG tags',
    dataLayer: 'ga4',
    jsonLd: false,
    openGraph: false,
  },
  {
    id: 'c3',
    label: 'JSON-LD Only',
    description: 'Full Product schema; no dataLayer events; no OG tags',
    dataLayer: 'suppress',
    jsonLd: 'full',
    openGraph: false,
  },
  {
    id: 'c4',
    label: 'OpenGraph Only',
    description: 'Full OG + product: tags; no dataLayer; no JSON-LD',
    dataLayer: 'suppress',
    jsonLd: false,
    openGraph: 'full',
  },
  {
    id: 'c5',
    label: 'DataLayer + JSON-LD',
    description: 'GA4 events + full Product schema; no OG',
    dataLayer: 'ga4',
    jsonLd: 'full',
    openGraph: false,
  },
  {
    id: 'c6',
    label: 'DataLayer + OpenGraph',
    description: 'GA4 events + full OG tags; no JSON-LD',
    dataLayer: 'ga4',
    jsonLd: false,
    openGraph: 'full',
  },
  {
    id: 'c7',
    label: 'JSON-LD + OG Complementary',
    description: 'JSON-LD has brand/sku/rating but NO price; OG has price/availability but NOT brand/sku — each fills the other\'s gaps',
    dataLayer: 'suppress',
    jsonLd: 'no-price',
    openGraph: 'price-only',
  },
  {
    id: 'c8',
    label: 'Non-Standard DataLayer',
    description: 'Custom event names (productDetailView) and field names (productId, unitPrice) — requires automapper to detect schema',
    dataLayer: 'nonstandard',
    jsonLd: false,
    openGraph: false,
  },
  {
    id: 'c9',
    label: 'Sparse / Partial Everywhere',
    description: 'All three sources present but each missing critical fields — reveals worst-case gap scenarios',
    dataLayer: 'partial',
    jsonLd: 'minimal',
    openGraph: 'minimal',
  },
  {
    id: 'c10',
    label: 'CEDDL + JSON-LD + OG',
    description: 'digitalData CEDDL object + full JSON-LD + full OG — tests CEDDL detection alongside schema.org',
    dataLayer: 'ceddl',
    jsonLd: 'full',
    openGraph: 'full',
  },
  {
    id: 'c11',
    label: 'Absolute Zero',
    description: 'Stripped clean — no dataLayer ecommerce events, no JSON-LD schemas, and no OpenGraph tags.',
    dataLayer: 'suppress',
    jsonLd: false,
    openGraph: false,
  },
];

// Non-standard field mappings used by c8
const NONSTANDARD_FIELD_MAP = {
  events: {
    view_item: 'productDetailView',
    view_item_list: 'productListView',
    add_to_cart: 'basketAdd',
    purchase: 'orderComplete',
    page_view: 'pageView',
  },
  itemFields: {
    item_id: 'productId',
    item_name: 'productName',
    item_brand: 'brand',
    item_category: 'category',
    item_category2: 'subcategory',
    item_variant: 'variant',
    price: 'unitPrice',
    quantity: 'qty',
    index: 'position',
  },
  ecommerceFields: {
    currency: 'currencyCode',
    value: 'revenue',
    transaction_id: 'orderId',
    items: 'products',
  },
};

module.exports = { VARIANTS, NONSTANDARD_FIELD_MAP };
