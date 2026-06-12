# Criteo Dynamic Test Shop

A structured-data testing platform that simulates a fashion e-commerce storefront. Its purpose is to validate tag integration, analytics containers (GTM/GA4), and metadata scraping engines (schema.org crawlers) across 11 predefined data quality configurations — from perfect canonical multi-source setups down to absolute zero (no tags at all).

Live site: [https://komplettsystem.github.io/criteo-dynamic-test-shop](https://komplettsystem.github.io/criteo-dynamic-test-shop)

---

## What this is for

Each "variant" (c1–c11) controls three independent signal axes simultaneously:

| Signal | Controls |
|--------|----------|
| `dataLayer` | GTM/GA4 event push behavior |
| `JSON-LD` | `<script type="application/ld+json">` structured data |
| `OpenGraph` | `<meta>` social/product tags in `<head>` |

This lets you test how a scraper, tag validator, or analytics container behaves when:
- All signals are present and canonical (c1)
- Only one signal type is available (c2, c3, c4)
- Signals are partial, non-standard, or sparse (c7–c9)
- A CEDDL `digitalData` layer is used instead of GA4 (c10)
- Nothing is present at all (c11)

See `TESTING_GUIDE.md` for the full signal matrix.

---

## Tech stack

- **Frontend:** Vanilla JS single-page app, zero runtime dependencies
- **Build:** `build.sh` (Bash) — copies assets, injects GTM ID, generates `dist/`
- **Hosting:** GitHub Pages with `404.html` routing fallback
- **Product catalog:** CSV-based (`catalog.csv`, 30 products)
- **Tests:** Playwright + TypeScript

---

## Local development

**Requirements:** Python 3, Node.js 20+

```bash
# 1. Build the site
./build.sh

# 2. Serve locally (handles SPA routing like GitHub Pages does)
python3 scripts/serve_local.py
# → http://127.0.0.1:8080
```

The Python server serves from `dist/` and falls back to `404.html` for any path that doesn't match a file — mirroring the GitHub Pages routing behavior.

---

## Running automated tests

All test commands run from the `tests/` directory:

```bash
cd tests
npm install          # first time only
npm install --save-dev @playwright/test && npx playwright install chromium  # install browser
```

### Run modes

| Command | What it does |
|---------|--------------|
| `npm test` | All 44 tests (11 variants × 4 page types), headless |
| `npm run test:headed` | Same, with visible browser window |
| `npm run automap` | Generate gap report + JQ field mapping templates |
| `npm run drift` | Compare current signals against saved baselines |
| `npm run orchestrate` | Full pipeline: test → poll TEMO API → automap |
| `npm run orchestrate:prod` | Same, against production TEMO URL |

### Test against a different URL

By default tests run against the live GitHub Pages site. Override with `BASE_URL`:

```bash
# Test against local dev server
BASE_URL=http://localhost:8080 npm test

# Test against a staging deployment
BASE_URL=https://staging.example.com npm test
```

### Test specific variants only

```bash
npx ts-node orchestrator.ts --configs=c1,c2,c3
npx ts-node orchestrator.ts --configs=c1,c2,c3 --prod
```

### Test reports

After a test run, reports are written to:

| Path | Contents |
|------|----------|
| `tests/automapper/reports/playwright-results.json` | Raw Playwright JSON output |
| `tests/automapper/reports/gap-report.json` | Which fields are present/missing per variant |
| `tests/automapper/reports/drift-report.json` | Changes from saved baselines |
| `tests/test-results/` | Playwright HTML report (open with `npx playwright show-report`) |

---

## Variant configurations (c1–c11)

| Variant | DataLayer | JSON-LD | OpenGraph | Use case |
|---------|-----------|---------|-----------|----------|
| c1 | ga4 full | full | full | Perfect baseline — all signals canonical |
| c2 | ga4 full | — | — | DataLayer only (browser-side fallback) |
| c3 | suppressed | full | — | JSON-LD only (schema.org crawler fallback) |
| c4 | suppressed | — | full | OpenGraph only (social tag fallback) |
| c5 | ga4 full | full | — | DataLayer + JSON-LD (common server combo) |
| c6 | ga4 full | — | full | DataLayer + OpenGraph (simple ecomm) |
| c7 | suppressed | no-price | price-only | Stitched gap — complementary sources |
| c8 | nonstandard | — | — | Custom schema with non-GA4 field names |
| c9 | partial | minimal | minimal | Sparse/degraded quality |
| c10 | ceddl | full | full | CEDDL `digitalData` standard instead of GA4 |
| c11 | suppressed | — | — | Absolute zero — no tracking |

---

## URL query parameters for automation

Pages accept query parameters to override the variant configuration without a build step:

```
# Override full variant preset
/c1/product/TSHIRT-001-RED-M.html?variant=c11

# Override individual axes
/c1/product/SHOE-003-WHT-42.html?dataLayer=partial&jsonLd=minimal&openGraph=minimal

# Suppress dataLayer, keep full JSON-LD
/c1/product/TSHIRT-001-RED-M.html?dataLayer=suppress&jsonLd=full
```

Valid values per axis:

| Parameter | Valid values |
|-----------|-------------|
| `variant` | `c1` – `c11` |
| `dataLayer` | `ga4`, `suppress`, `nonstandard`, `ceddl`, `partial`, `false` |
| `jsonLd` | `full`, `no-price`, `minimal`, `false` |
| `openGraph` | `full`, `price-only`, `minimal`, `false` |

---

## Test oracle

On product pages, `window.__expectedSignals` is exposed for automated assertions:

```javascript
const oracle = await page.evaluate(() => window.__expectedSignals);
// {
//   pageType: 'product',
//   activeConfig: 'c1',
//   canonical: { /* all product fields */ },
//   expectedFields: ['name', 'price', 'currency', ...]
// }
```

Use this to write assertions without hardcoding expected values.

---

## Manual inspection (browser UI)

Every page includes a floating **Tag & Schema Inspector** widget (the `🏷️` button, bottom-right). It lets you:

- Switch between variant presets or tweak individual axes on the fly
- Inspect the live `dataLayer` array, active JSON-LD blocks, and OpenGraph meta tags
- View the Oracle checklist on product pages (which fields are expected under the active config)

---

## Build & deployment

```bash
# Local build
./build.sh
# Output: dist/ (index.html, 404.html, images/, catalog.csv, TESTING_GUIDE.md)

# GitHub Actions auto-deploys to GitHub Pages on push to main
# GTM_ID env var is injected during CI build (defaults to GTM-TEST1234 in CI)
```

The weekly drift detection workflow (`drift-detect.yml`) runs every Monday at 07:00 UTC, compares current signals against saved baselines, and opens a GitHub issue if a field disappears.

---

## Repository mirrors

| Remote | URL |
|--------|-----|
| GitHub | `https://github.com/komplettsystem/criteo-dynamic-test-shop` |
| GitLab | `git@gitlab.crto.in:data-collaboration/criteo-dynamic-test-shop` |
