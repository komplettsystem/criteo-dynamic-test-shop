#!/usr/bin/env python3
"""Static site generator for 'fashion Custom'.

Reads catalog.csv and emits index.html, category pages, and per-SKU
product pages. The dataLayer is intentionally absent. JSON-LD blocks
use schema.org @context/@type but rename product properties to custom
names. Open Graph property names are also renamed.
"""

import csv
import html
import json
import os
from datetime import datetime, timedelta

ROOT = os.path.dirname(os.path.abspath(__file__))
CATALOG = os.path.join(ROOT, "catalog.csv")

SITE = {
    "title": "fashion Custom",
    "tagline": "A bespoke catalogue of apparel, footwear and accessories.",
    "url": "https://fashion-custom.example",
    "logo": "/images/hero-banner.png",
    "currency": "EUR",
    "locale": "en_US",
}


def read_catalog():
    with open(CATALOG, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def availability_label(qty):
    n = int(qty or 0)
    if n <= 0:
        return "OutOfStock"
    if n < 5:
        return "LimitedAvailability"
    return "InStock"


def og_meta(props):
    """Render meta tags with renamed Open Graph property names."""
    lines = []
    for name, content in props.items():
        if content in (None, ""):
            continue
        lines.append(
            f'  <meta property="{name}" content="{html.escape(str(content), quote=True)}" />'
        )
    return "\n".join(lines)


def jsonld(obj):
    return (
        '<script type="application/ld+json">\n'
        + json.dumps(obj, ensure_ascii=False, indent=2)
        + "\n</script>"
    )


def organization_ld():
    return {
        "@context": "https://schema.org",
        "@type": "Organization",
        "label": SITE["title"],
        "homepage": SITE["url"],
        "emblem": SITE["url"] + SITE["logo"],
        "blurb": SITE["tagline"],
    }


def website_ld():
    return {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "label": SITE["title"],
        "homepage": SITE["url"],
    }


def product_ld(p):
    """JSON-LD Product with renamed (non-standard) property names."""
    url = f"{SITE['url']}/products/{p['sku']}.html"
    valid_thru = (datetime.utcnow() + timedelta(days=365)).date().isoformat()
    image = p["image"] if p["image"].startswith("http") else SITE["url"] + p["image"]

    o = {
        "@context": "https://schema.org",
        "@type": "Product",
        "@id": url + "#item",
        "item_title": p["name"],
        "prod_ref": p["sku"],
        "page_link": url,
        "visual": [image],
        "maker": {"@type": "Brand", "label": p["brand"]},
        "group_label": " > ".join(x for x in [p.get("category_1"), p.get("category_2")] if x),
        "deal": {
            "@type": "Offer",
            "page_link": url,
            "cost_unit": SITE["currency"],
            "cost_value": f"{float(p['price']):.2f}",
            "valid_thru": valid_thru,
            "stock_state": "https://schema.org/" + availability_label(p["quantity"]),
            "state": "https://schema.org/NewCondition",
            "vendor": {"@type": "Organization", "label": SITE["title"]},
        },
    }
    if p.get("description"):
        o["blurb"] = p["description"]
    if p.get("gtin"):
        o["barcode_13"] = p["gtin"]
    if p.get("mpn"):
        o["maker_code"] = p["mpn"]
    if p.get("color"):
        o["shade"] = p["color"]
    if p.get("size"):
        o["fit_size"] = p["size"]
    if p.get("material"):
        o["fabric"] = p["material"]
    if p.get("id"):
        o["parent_group"] = {
            "@type": "ProductGroup",
            "group_ref": p["id"],
            "varies_on": ["shade", "fit_size"],
        }
    if p.get("gender"):
        o["for_who"] = {"@type": "PeopleAudience", "gender_pref": p["gender"]}
    if p.get("rating_value") and p.get("rating_count"):
        o["score"] = {
            "@type": "AggregateRating",
            "score_avg": p["rating_value"],
            "score_count": p["rating_count"],
            "score_max": "5",
            "score_min": "1",
        }
    return o


def breadcrumb_ld(items):
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "trail": [
            {"@type": "ListItem", "rank": i + 1, "label": it["name"], "destination": it["url"]}
            for i, it in enumerate(items)
        ],
    }


def item_list_ld(products, label):
    return {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "label": label,
        "count": len(products),
        "entries": [
            {
                "@type": "ListItem",
                "rank": i + 1,
                "destination": f"{SITE['url']}/products/{p['sku']}.html",
                "node": {
                    "@type": "Product",
                    "item_title": p["name"],
                    "prod_ref": p["sku"],
                    "visual": (
                        p["image"] if p["image"].startswith("http") else SITE["url"] + p["image"]
                    ),
                    "maker": {"@type": "Brand", "label": p["brand"]},
                    "deal": {
                        "@type": "Offer",
                        "cost_unit": SITE["currency"],
                        "cost_value": f"{float(p['price']):.2f}",
                        "stock_state": "https://schema.org/" + availability_label(p["quantity"]),
                    },
                },
            }
            for i, p in enumerate(products[:50])
        ],
    }


def page_shell(title, head_extra, body, base_prefix=""):
    """Wrap a page in the shared HTML shell. base_prefix lets nested pages
    point back to the site root (e.g. '../' for /products/foo.html)."""
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{html.escape(title)}</title>
  <link rel="icon" type="image/svg+xml" href="{base_prefix}assets/favicon.svg" />
  <link rel="stylesheet" href="{base_prefix}assets/styles.css" />
{head_extra}
</head>
<body>
  <header class="site-header">
    <a class="brand" href="{base_prefix}index.html">{html.escape(SITE['title'])}</a>
    <nav class="site-nav">
      <a href="{base_prefix}categories/apparel.html">Apparel</a>
      <a href="{base_prefix}categories/footwear.html">Footwear</a>
      <a href="{base_prefix}categories/accessories.html">Accessories</a>
    </nav>
  </header>
  <main>
{body}
  </main>
  <footer class="site-footer">
    <p>&copy; {datetime.utcnow().year} {html.escape(SITE['title'])}. Static showcase — no tracking.</p>
  </footer>
</body>
</html>
"""


def product_card(p, base_prefix=""):
    img = p["image"] if p["image"].startswith("http") else base_prefix + p["image"].lstrip("/")
    return f"""    <article class="product-card">
      <a href="{base_prefix}products/{html.escape(p['sku'])}.html">
        <img src="{html.escape(img)}" alt="{html.escape(p['name'])}" loading="lazy" />
        <h3>{html.escape(p['name'])}</h3>
        <p class="muted">{html.escape(p['brand'])}</p>
        <p class="price">{SITE['currency']} {float(p['price']):.2f}</p>
      </a>
    </article>"""


def build_home(products):
    title = f"{SITE['title']} — {SITE['tagline']}"
    og = og_meta({
        "og:headline": title,
        "og:blurb": SITE["tagline"],
        "og:cover": SITE["url"] + SITE["logo"],
        "og:link": SITE["url"] + "/",
        "og:kind": "website",
        "og:source": SITE["title"],
        "og:region": SITE["locale"],
    })
    head_extra = "\n".join([
        f'  <meta name="description" content="{html.escape(SITE["tagline"], quote=True)}" />',
        f'  <link rel="canonical" href="{SITE["url"]}/" />',
        og,
        "  " + jsonld(organization_ld()).replace("\n", "\n  "),
        "  " + jsonld(website_ld()).replace("\n", "\n  "),
        "  " + jsonld(item_list_ld(products, SITE["title"] + " — All items")).replace("\n", "\n  "),
    ])
    cards = "\n".join(product_card(p) for p in products)
    body = f"""    <section class="hero">
      <h1>{html.escape(SITE['title'])}</h1>
      <p>{html.escape(SITE['tagline'])}</p>
    </section>
    <section class="grid">
{cards}
    </section>"""
    return page_shell(title, head_extra, body)


def build_category(name, products):
    title = f"{name} — {SITE['title']}"
    url = f"{SITE['url']}/categories/{name.lower()}.html"
    cover_src = (products[0]["image"] if products and products[0]["image"].startswith("http")
                 else SITE["url"] + (products[0]["image"] if products else SITE["logo"]))
    desc = f"Browse our {name} collection — {len(products)} items."
    og = og_meta({
        "og:headline": title,
        "og:blurb": desc,
        "og:cover": cover_src,
        "og:link": url,
        "og:kind": "website",
        "og:source": SITE["title"],
        "og:region": SITE["locale"],
    })
    head_extra = "\n".join([
        f'  <meta name="description" content="{html.escape(desc, quote=True)}" />',
        f'  <link rel="canonical" href="{url}" />',
        og,
        "  " + jsonld(item_list_ld(products, name)).replace("\n", "\n  "),
        "  " + jsonld(breadcrumb_ld([
            {"name": "Home", "url": SITE["url"] + "/"},
            {"name": name, "url": url},
        ])).replace("\n", "\n  "),
    ])
    cards = "\n".join(product_card(p, base_prefix="../") for p in products)
    body = f"""    <section class="page-head">
      <h1>{html.escape(name)}</h1>
      <p class="muted">{html.escape(desc)}</p>
    </section>
    <section class="grid">
{cards}
    </section>"""
    return page_shell(title, head_extra, body, base_prefix="../")


def build_product(p):
    title = f"{p['name']} — {p['brand']} | {SITE['title']}"
    url = f"{SITE['url']}/products/{p['sku']}.html"
    desc = p.get("description") or f"{p['name']} by {p['brand']}"
    img_abs = p["image"] if p["image"].startswith("http") else SITE["url"] + p["image"]
    img_rel = p["image"] if p["image"].startswith("http") else "../" + p["image"].lstrip("/")
    og = og_meta({
        "og:headline": title,
        "og:blurb": desc,
        "og:cover": img_abs,
        "og:link": url,
        "og:kind": "product",
        "og:source": SITE["title"],
        "og:region": SITE["locale"],
        # renamed product:* facebook tags as well
        "shop:cost_amount": f"{float(p['price']):.2f}",
        "shop:cost_currency": SITE["currency"],
        "shop:stock_state": "in stock" if int(p["quantity"] or 0) > 0 else "out of stock",
        "shop:state": "new",
        "shop:maker": p["brand"],
        "shop:prod_ref": p["sku"],
        "shop:group_ref": p["id"],
        "shop:shade": p.get("color"),
        "shop:fit_size": p.get("size"),
        "shop:gender_pref": p.get("gender"),
    })
    cat = p.get("category_1") or "Catalog"
    head_extra = "\n".join([
        f'  <meta name="description" content="{html.escape(desc, quote=True)}" />',
        f'  <link rel="canonical" href="{url}" />',
        og,
        "  " + jsonld(product_ld(p)).replace("\n", "\n  "),
        "  " + jsonld(breadcrumb_ld([
            {"name": "Home", "url": SITE["url"] + "/"},
            {"name": cat, "url": f"{SITE['url']}/categories/{cat.lower()}.html"},
            {"name": p["name"], "url": url},
        ])).replace("\n", "\n  "),
    ])
    body = f"""    <article class="product-detail">
      <div class="gallery">
        <img src="{html.escape(img_rel)}" alt="{html.escape(p['name'])}" />
      </div>
      <div class="info">
        <p class="crumbs"><a href="../index.html">Home</a> / <a href="../categories/{cat.lower()}.html">{html.escape(cat)}</a> / {html.escape(p['name'])}</p>
        <h1>{html.escape(p['name'])}</h1>
        <p class="brand">By {html.escape(p['brand'])}</p>
        <p class="price">{SITE['currency']} {float(p['price']):.2f}</p>
        <dl class="attrs">
          <dt>Reference</dt><dd>{html.escape(p['sku'])}</dd>
          <dt>Shade</dt><dd>{html.escape(p.get('color') or '-')}</dd>
          <dt>Fit size</dt><dd>{html.escape(p.get('size') or '-')}</dd>
          <dt>Fabric</dt><dd>{html.escape(p.get('material') or '-')}</dd>
          <dt>Audience</dt><dd>{html.escape(p.get('gender') or '-')}</dd>
        </dl>
        <p class="blurb">{html.escape(p.get('description') or '')}</p>
      </div>
    </article>"""
    return page_shell(title, head_extra, body, base_prefix="../")


def main():
    products = read_catalog()

    # Home
    with open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8") as f:
        f.write(build_home(products))

    # Categories (top-level)
    cats = sorted({p["category_1"] for p in products if p.get("category_1")})
    for c in cats:
        items = [p for p in products if p["category_1"] == c]
        path = os.path.join(ROOT, "categories", c.lower() + ".html")
        with open(path, "w", encoding="utf-8") as f:
            f.write(build_category(c, items))

    # Product pages
    for p in products:
        path = os.path.join(ROOT, "products", p["sku"] + ".html")
        with open(path, "w", encoding="utf-8") as f:
            f.write(build_product(p))

    print(f"Wrote 1 home + {len(cats)} categories + {len(products)} product pages.")


if __name__ == "__main__":
    main()
