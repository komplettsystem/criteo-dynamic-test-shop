# 🛡️ Fashion Shop — Tag & Schema Testing Guide

Welcome to the Fashion Shop testing platform! This environment is built specifically to test tag integration, analytics containers (e.g., GTM), and metadata scraping engines (e.g., schema.org/crawlers) across a continuous spectrum of structured data quality—from perfect, canonical multi-source setups down to absolute zero ("nothing").

---

## 🎛️ For Manual Testers

Every variant page (including standard category, product, and homepages) now includes an interactive **Tag & Schema Inspector** widget in the bottom-right corner.

### How to use the Inspector Panel:
1. **Open the Panel:** Click the circular floating tag icon (`🏷️`) in the bottom-right corner.
2. **Read Active Quality Configuration:** Under **Active Variant Template**, you'll see the current baseline configuration (e.g., `c1: Full Canonical`).
3. **Change the Baseline Variant:** Select a different variant from the dropdown (e.g., `c11: Absolute Zero`) and click **Apply Overrides**. The page will hot-reload with the new schema configurations applied instantly.
4. **Apply Granular Core Overrides:** Want to test a highly specific edge case? Tweak the **DataLayer**, **JSON-LD**, and **OpenGraph** select lists independently. For example:
   * Select `DataLayer: Suppress`
   * Select `JSON-LD: No Price`
   * Select `OpenGraph: Price Only`
   * Click **Apply Overrides** to see a complementary, gapped schema in action!
5. **Inspect Live Signals:**
   * **`dataLayer` Tab:** Displays the live, interactive `window.dataLayer` array in real-time. Use it to trace event sequences (like `view_item`, `add_to_cart`, or custom events).
   * **`JSON-LD` Tab:** Prints all structured `<script type="application/ld+json">` schemas currently active on the page.
   * **`OpenGraph` Tab:** Lists all social and product meta-tags currently injected in the `<head>` (e.g., `og:title`, `product:retailer_item_id`, `product:price:amount`).
   * **`Oracle` Tab:** (Only active on Product pages) Displays a glowing checklist of target entities and visualizes which data points are expected to be scraped under the active schema rules.

---

## 🤖 For Automation & Bots

If you are writing automated scripts (e.g., Playwright, Puppeteer, Cypress, or a python crawler), the test shop offers headless, programmatically controlled testing without needing static build steps or configuration cards.

### 1. Controlling the Simulator via URL Query Parameters

You can instruct the shop to render any schema state on the fly by appending query parameters to the URL:

| Query Parameter | Allowed Values | Description |
| :--- | :--- | :--- |
| `variant` | `c1` – `c11` | Overrides the baseline variant layout immediately. |
| `dataLayer` | `ga4`, `suppress`, `nonstandard`, `ceddl`, `partial`, `false` | Sets the dataLayer implementation. |
| `jsonLd` | `full`, `no-price`, `minimal`, `false` | Controls the schema.org injection detail. |
| `openGraph` | `full`, `price-only`, `minimal`, `false` | Adjusts OpenGraph/Twitter card meta tags in `<head>`. |

#### Example URLs for Automation:
* **Test the Absolute Zero setup (no tracking):**
  `/c1/product/TSHIRT-001-RED-M.html?variant=c11`
* **Test Custom DataLayer with No JSON-LD:**
  `/c1/product/SHOE-003-WHT-42.html?dataLayer=nonstandard&jsonLd=false`
* **Verify Sparse Schemas:**
  `/c1/product/ACC-004-GLD.html?dataLayer=partial&jsonLd=minimal&openGraph=minimal`

---

### 2. Scraping the DOM Test Oracle (`window.__expectedSignals`)

To eliminate hardcoded verification logic from your test scripts, the shop calculates the exact "expected truth" on page load and exposes it on the global `window` object. 

Automated test scripts can evaluate this object to instantly align their assertions with the active test parameters:

```javascript
// Example: Playwright test code
test('automated tag verification', async ({ page }) => {
  // 1. Visit product page simulating a complementary gap schema
  await page.goto('/c1/product/TSHIRT-001-RED-M.html?jsonLd=no-price&openGraph=price-only');
  
  // 2. Retrieve expected signals from the Test Oracle
  const oracle = await page.evaluate(() => window.__expectedSignals);
  
  console.log(oracle.expectedFields); 
  // Output: ["productId", "productName", "brand", "category", "price", "currency", "availability", ...]
  
  console.log(oracle.canonical.price); 
  // Output: "29.99" (the exact true price for the product)
  
  // 3. Extract actual scraped metadata and assert against oracle rules
  const scrapedData = await myMetadataScraper(page);
  
  for (const field of oracle.expectedFields) {
    expect(scrapedData[field]).toBe(oracle.canonical[field]);
  }
});
```

#### Expected Oracle Structure:
```json
{
  "pageType": "product",
  "activeConfig": {
    "id": "c1",
    "dataLayer": "ga4",
    "jsonLd": "no-price",
    "openGraph": "price-only"
  },
  "canonical": {
    "productId": "TSHIRT-001-RED-M",
    "productName": "Red Premium Cotton T-Shirt",
    "brand": "Fashion Brand",
    "price": "29.99",
    "currency": "EUR",
    "category": "Apparel",
    "availability": "InStock"
    // ... all high-fidelity canonical specs
  },
  "expectedFields": [
    "productId",
    "productName",
    "brand",
    "category",
    "price",
    "currency",
    "availability",
    "color"
  ]
}
```

---

## 🚦 The Data Quality Spectrum Reference

Use this matrix to understand what signals are present in each predefined variant:

| Variant | DataLayer | JSON-LD | OpenGraph | Target Quality Objective |
| :---: | :--- | :--- | :--- | :--- |
| **`c1`** | `ga4` (Full) | `full` (Complete) | `full` (Complete) | **Perfect Baseline:** Maximum data quality, clean signals. |
| **`c2`** | `ga4` (Full) | `false` | `false` | **DataLayer Only:** Tests browser fallback scraper detection. |
| **`c3`** | `suppress` | `full` (Complete) | `false` | **JSON-LD Only:** Tests schema.org parser fallback accuracy. |
| **`c4`** | `suppress` | `false` | `full` (Complete) | **OpenGraph Only:** Tests social tag parser fallback accuracy. |
| **`c5`** | `ga4` (Full) | `full` (Complete) | `false` | **Hybrid DL + JSON-LD:** Common server-side/client combination. |
| **`c6`** | `ga4` (Full) | `false` | `full` (Complete) | **Hybrid DL + OG:** Common simple e-commerce setup. |
| **`c7`** | `suppress` | `no-price` | `price-only` | **Stitched Gap:** JSON-LD has brand/SKU; OG has price. Tests tag merger. |
| **`c8`** | `nonstandard` | `false` | `false` | **Custom Schema:** Custom events & key naming formats. |
| **`c9`** | `partial` | `minimal` | `minimal` | **Sparse Quality:** High data degradation. Tests basic field scraping. |
| **`c10`**| `ceddl` (Full) | `full` (Complete) | `full` (Complete) | **CEDDL standard:** Tests digitalData collection alongside standard specs. |
| **`c11`**| `suppress` | `false` | `false` | **Absolute Zero:** No events, no schema scripts, no OG. Complete void. |

---

## 🌐 Deployment & Subpath-Routing Architecture

To maximize simplicity and eliminate redundant configuration overhead, the testing platform operates on a **unified client-side routing and simulation engine** running inside a single, root `index.html` page (Option B). 

Because there are no longer 78 physically pre-compiled static HTML files in the repository, direct entries to virtual paths (such as `/c1/` or `/c3/product/SHOE-003-WHT-42.html`) must be routed to the central `index.html` page using the fallback mechanisms of GitHub Pages:

### GitHub Pages (Subpath Hosting Fallback)
GitHub Pages does not support custom error document configurations and serves projects on a repository subpath (e.g., `https://<username>.github.io/criteo-dynamic-test-shop/`).
* **The `404.html` Fallback:** GitHub Pages has a hardcoded rule: if a file named `404.html` exists in the repository root, it will serve it on any missing file path.
* **The Implementation:** Our [build.sh](file:///Users/k.rieke/Documents/antigravity/criteo-dynamic-test-shop/build.sh#L10) workflow automatically copies `index.html` to `dist/404.html` during the build process. When GitHub Pages encounters a virtual routing directory (like `/c1/`), it automatically falls back to `404.html`, loading our router engine seamlessly.
* **Dynamic `basePrefix` Resolution:** To ensure the simulator works out-of-the-box on subpath URLs (like GitHub Pages), the routing script dynamically searches the pathname for the `/c\d+` variant segment:
  * It extracts the `basePrefix` (e.g. `/criteo-dynamic-test-shop`) dynamically.
  * It prefixes all dynamic script loads, stylesheet links, catalog fetches, and storefront link anchors with this prefix, ensuring the site is 100% portable and subpath-agnostic.

