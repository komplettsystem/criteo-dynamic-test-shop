#!/usr/bin/env python3
"""fashion gtag — variant 2.

GA4 implemented via gtag.js with standard event names and the
canonical items[] schema:
  - page_view (auto)
  - view_item_list on listings
  - view_item on PDP
JSON-LD is standard schema.org.
"""

import json
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _lib import (  # noqa: E402
    abs_url, availability_label, category_pages, esc, jsonld_block, page_shell,
    product_card, read_catalog, script_inline, write,
)

ROOT = os.path.dirname(os.path.abspath(__file__))
CATALOG = os.path.join(os.path.dirname(ROOT), "catalog.csv")

SITE = {
    "title": "fashion gtag",
    "tagline": "Apparel, footwear & accessories — GA4 gtag.js demo.",
    "url": "https://fashion-gtag.example",
    "logo": "/images/hero-banner.png",
    "currency": "EUR",
    "locale": "en_US",
}

# Placeholder Measurement ID — replace with a real G-XXXXXXXXXX to send hits.
GA4_ID = "G-FASHIONGTAG"

NAV = [("Apparel", "categories/apparel.html"),
       ("Footwear", "categories/footwear.html"),
       ("Accessories", "categories/accessories.html")]


# ---------- gtag bootstrap ----------

def gtag_loader():
    """Async loader + base config. Standard GA4 boilerplate."""
    return (
        f'<script async src="https://www.googletagmanager.com/gtag/js?id={GA4_ID}"></script>\n'
        f'  <script>\n'
        f'  window.dataLayer = window.dataLayer || [];\n'
        f'  function gtag(){{dataLayer.push(arguments);}}\n'
        f'  gtag(\'js\', new Date());\n'
        f'  gtag(\'config\', \'{GA4_ID}\', {{ send_page_view: true }});\n'
        f'  </script>'
    )


def gtag_event(name, params):
    return script_inline(
        f"gtag('event', {json.dumps(name)}, {json.dumps(params, ensure_ascii=False)});"
    )


def ga4_item(p, list_id=None, list_name=None, index=None):
    """Standard GA4 ecommerce item object."""
    o = {
        "item_id": p["sku"],
        "item_name": p["name"],
        "item_brand": p["brand"],
        "item_category": p.get("category_1") or "",
        "item_category2": p.get("category_2") or "",
        "item_variant": p.get("variant") or "",
        "price": float(p["price"]),
        "currency": SITE["currency"],
        "quantity": 1,
    }
    if list_id:
        o["item_list_id"] = list_id
    if list_name:
        o["item_list_name"] = list_name
    if index is not None:
        o["index"] = index
    return o


# ---------- JSON-LD (standard schema.org) ----------

def organization_ld():
    return {"@context": "https://schema.org", "@type": "Organization",
            "name": SITE["title"], "url": SITE["url"],
            "logo": abs_url(SITE["url"], SITE["logo"]),
            "description": SITE["tagline"]}


def website_ld():
    return {"@context": "https://schema.org", "@type": "WebSite",
            "name": SITE["title"], "url": SITE["url"]}


def product_ld(p):
    url = f"{SITE['url']}/products/{p['sku']}.html"
    valid_thru = (datetime.utcnow() + timedelta(days=365)).date().isoformat()
    o = {
        "@context": "https://schema.org", "@type": "Product",
        "@id": url + "#product",
        "name": p["name"], "sku": p["sku"], "url": url,
        "image": [abs_url(SITE["url"], p["image"])],
        "brand": {"@type": "Brand", "name": p["brand"]},
        "category": " > ".join(x for x in [p.get("category_1"), p.get("category_2")] if x),
        "offers": {
            "@type": "Offer", "url": url,
            "priceCurrency": SITE["currency"],
            "price": f"{float(p['price']):.2f}",
            "priceValidUntil": valid_thru,
            "availability": "https://schema.org/" + availability_label(p["quantity"]),
            "itemCondition": "https://schema.org/NewCondition",
            "seller": {"@type": "Organization", "name": SITE["title"]},
        },
    }
    if p.get("description"): o["description"] = p["description"]
    if p.get("gtin"):        o["gtin13"] = p["gtin"]
    if p.get("mpn"):         o["mpn"] = p["mpn"]
    if p.get("color"):       o["color"] = p["color"]
    if p.get("size"):        o["size"] = p["size"]
    if p.get("material"):    o["material"] = p["material"]
    if p.get("rating_value") and p.get("rating_count"):
        o["aggregateRating"] = {
            "@type": "AggregateRating",
            "ratingValue": p["rating_value"], "reviewCount": p["rating_count"],
            "bestRating": "5", "worstRating": "1",
        }
    return o


def breadcrumb_ld(items):
    return {"@context": "https://schema.org", "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": i + 1, "name": it["name"], "item": it["url"]}
                for i, it in enumerate(items)]}


# ---------- pages ----------

def head_common(title, description, canonical, og_image, og_type="website"):
    return "\n".join([
        f'  <meta name="description" content="{esc(description)}" />',
        f'  <link rel="canonical" href="{esc(canonical)}" />',
        f'  <meta property="og:type" content="{esc(og_type)}" />',
        f'  <meta property="og:title" content="{esc(title)}" />',
        f'  <meta property="og:description" content="{esc(description)}" />',
        f'  <meta property="og:url" content="{esc(canonical)}" />',
        f'  <meta property="og:image" content="{esc(og_image)}" />',
        f'  <meta property="og:site_name" content="{esc(SITE["title"])}" />',
        f'  <meta property="og:locale" content="{esc(SITE["locale"])}" />',
        '  <meta name="twitter:card" content="summary_large_image" />',
        f'  <meta name="twitter:title" content="{esc(title)}" />',
        f'  <meta name="twitter:description" content="{esc(description)}" />',
        f'  <meta name="twitter:image" content="{esc(og_image)}" />',
        "  " + gtag_loader(),
    ])


def build_home(products):
    title = f"{SITE['title']} — Home"
    canonical = SITE["url"] + "/"
    items = [ga4_item(p, list_id="home_grid", list_name="Home grid", index=i)
             for i, p in enumerate(products[:20])]
    head = "\n".join([
        head_common(title, SITE["tagline"], canonical, abs_url(SITE["url"], SITE["logo"])),
        "  " + gtag_event("view_item_list", {
            "item_list_id": "home_grid", "item_list_name": "Home grid",
            "items": items,
        }),
        "  " + jsonld_block(organization_ld()),
        "  " + jsonld_block(website_ld()),
    ])
    cards = "\n".join(product_card(p, currency=SITE["currency"]) for p in products)
    body = f"""    <section class="hero">
      <h1>{esc(SITE['title'])}</h1>
      <p>{esc(SITE['tagline'])}</p>
    </section>
    <section class="grid">
{cards}
    </section>"""
    return page_shell(title=title, head_extra=head, body=body, base_prefix="",
                      brand_label=SITE["title"], nav=NAV)


def build_category(name, products):
    title = f"{name} — {SITE['title']}"
    canonical = f"{SITE['url']}/categories/{name.lower()}.html"
    desc = f"{name} collection — {len(products)} items."
    cover = abs_url(SITE["url"], products[0]["image"] if products else SITE["logo"])
    list_id = f"cat_{name.lower()}"
    items = [ga4_item(p, list_id=list_id, list_name=name, index=i)
             for i, p in enumerate(products[:50])]
    head = "\n".join([
        head_common(title, desc, canonical, cover),
        "  " + gtag_event("view_item_list", {
            "item_list_id": list_id, "item_list_name": name, "items": items,
        }),
        "  " + jsonld_block(breadcrumb_ld([
            {"name": "Home", "url": SITE["url"] + "/"},
            {"name": name, "url": canonical},
        ])),
    ])
    cards = "\n".join(product_card(p, base_prefix="../", currency=SITE["currency"])
                      for p in products)
    body = f"""    <section class="page-head">
      <h1>{esc(name)}</h1>
      <p class="muted">{esc(desc)}</p>
    </section>
    <section class="grid">
{cards}
    </section>"""
    return page_shell(title=title, head_extra=head, body=body, base_prefix="../",
                      brand_label=SITE["title"], nav=NAV)


def build_product(p):
    title = f"{p['name']} — {p['brand']} | {SITE['title']}"
    canonical = f"{SITE['url']}/products/{p['sku']}.html"
    desc = p.get("description") or f"{p['name']} by {p['brand']}"
    img_abs = abs_url(SITE["url"], p["image"])
    img_rel = p["image"] if p["image"].startswith("http") else "../" + p["image"].lstrip("/")
    cat = p.get("category_1") or "Catalog"
    head = "\n".join([
        head_common(title, desc, canonical, img_abs, og_type="product"),
        "  " + gtag_event("view_item", {
            "currency": SITE["currency"], "value": float(p["price"]),
            "items": [ga4_item(p)],
        }),
        "  " + jsonld_block(product_ld(p)),
        "  " + jsonld_block(breadcrumb_ld([
            {"name": "Home", "url": SITE["url"] + "/"},
            {"name": cat, "url": f"{SITE['url']}/categories/{cat.lower()}.html"},
            {"name": p["name"], "url": canonical},
        ])),
    ])
    body = f"""    <article class="product-detail">
      <div class="gallery">
        <img src="{esc(img_rel)}" alt="{esc(p['name'])}" />
      </div>
      <div class="info">
        <p class="crumbs"><a href="../index.html">Home</a> / <a href="../categories/{cat.lower()}.html">{esc(cat)}</a> / {esc(p['name'])}</p>
        <h1>{esc(p['name'])}</h1>
        <p class="brand">By {esc(p['brand'])}</p>
        <p class="price">{SITE['currency']} {float(p['price']):.2f}</p>
        <dl class="attrs">
          <dt>SKU</dt><dd>{esc(p['sku'])}</dd>
          <dt>Color</dt><dd>{esc(p.get('color') or '-')}</dd>
          <dt>Size</dt><dd>{esc(p.get('size') or '-')}</dd>
          <dt>Material</dt><dd>{esc(p.get('material') or '-')}</dd>
        </dl>
        <p class="blurb">{esc(p.get('description') or '')}</p>
      </div>
    </article>"""
    return page_shell(title=title, head_extra=head, body=body, base_prefix="../",
                      brand_label=SITE["title"], nav=NAV)


def main():
    products = read_catalog(CATALOG)
    write(os.path.join(ROOT, "index.html"), build_home(products))
    for name, items in category_pages(products).items():
        write(os.path.join(ROOT, "categories", name.lower() + ".html"),
              build_category(name, items))
    for p in products:
        write(os.path.join(ROOT, "products", p["sku"] + ".html"), build_product(p))
    print(f"[gtag] wrote home + {len(category_pages(products))} categories"
          f" + {len(products)} products")


if __name__ == "__main__":
    main()
