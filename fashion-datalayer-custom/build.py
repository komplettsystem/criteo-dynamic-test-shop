#!/usr/bin/env python3
"""fashion DataLayer Custom — variant 1.

A dataLayer is present, but field names are NOT GA4-compatible
(no item_id / item_name / item_brand / price / currency / items[]).
Some attributes are intentionally MISSING from the dataLayer
(gtin, mpn, color, size, material, availability, rating, image).
Those missing fields are recoverable from the JSON-LD layer below,
which uses STANDARD schema.org property names.
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
    "title": "fashion DataLayer Custom",
    "tagline": "Apparel, footwear & accessories — custom dataLayer demo.",
    "url": "https://fashion-datalayer-custom.example",
    "logo": "/images/hero-banner.png",
    "currency": "EUR",
    "locale": "en_US",
}

NAV = [("Apparel", "categories/apparel.html"),
       ("Footwear", "categories/footwear.html"),
       ("Accessories", "categories/accessories.html")]


# ---------- dataLayer (custom, non-GA4) ----------

def dl_init():
    """Initialize the dataLayer. No GTM container is loaded — pushes
    are recorded into window.dataLayer for inspection only."""
    return 'window.dataLayer = window.dataLayer || [];'


def dl_page(page_type, page_title, path):
    """Push a custom page-view event. Field names are non-standard:
    'fc.page_view' instead of 'page_view', 'page' object instead of
    GA4's page_location/page_title at the root."""
    payload = {
        "event": "fc.page_view",
        "page": {
            "type": page_type,
            "title": page_title,
            "path": path,
        },
        "site": {"name": SITE["title"], "money": SITE["currency"]},
    }
    return f'window.dataLayer.push({json.dumps(payload, ensure_ascii=False)});'


def dl_product(p):
    """Push a product-view event. Deliberately omits gtin/mpn/color/
    size/material/availability/rating/image — those are available in
    the JSON-LD on the same page."""
    payload = {
        "event": "fc.product_view",
        "product": {
            "code": p["sku"],              # not item_id / sku
            "title": p["name"],            # not item_name
            "label": p["brand"],           # not item_brand
            "bucket": "/".join(x for x in [p.get("category_1"), p.get("category_2")] if x),
            "cost": float(p["price"]),     # not price
            "money": SITE["currency"],     # not currency
        },
    }
    return f'window.dataLayer.push({json.dumps(payload, ensure_ascii=False)});'


def dl_list(label, items):
    """Custom list-view. No items[] array of standard GA4 items, just
    a slimmer 'roster' with renamed fields and only code+title+cost."""
    payload = {
        "event": "fc.list_view",
        "list": {
            "label": label,
            "size": len(items),
            "roster": [
                {"code": p["sku"], "title": p["name"], "cost": float(p["price"])}
                for p in items[:50]
            ],
        },
    }
    return f'window.dataLayer.push({json.dumps(payload, ensure_ascii=False)});'


# ---------- JSON-LD (standard schema.org) ----------

def organization_ld():
    return {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": SITE["title"],
        "url": SITE["url"],
        "logo": abs_url(SITE["url"], SITE["logo"]),
        "description": SITE["tagline"],
    }


def website_ld():
    return {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": SITE["title"],
        "url": SITE["url"],
    }


def product_ld(p):
    """STANDARD schema.org Product. Contains all the fields that the
    dataLayer omits, so a crawler can still see them here."""
    url = f"{SITE['url']}/products/{p['sku']}.html"
    valid_thru = (datetime.utcnow() + timedelta(days=365)).date().isoformat()
    image = abs_url(SITE["url"], p["image"])
    o = {
        "@context": "https://schema.org",
        "@type": "Product",
        "@id": url + "#product",
        "name": p["name"],
        "sku": p["sku"],
        "url": url,
        "image": [image],
        "brand": {"@type": "Brand", "name": p["brand"]},
        "category": " > ".join(x for x in [p.get("category_1"), p.get("category_2")] if x),
        "offers": {
            "@type": "Offer",
            "url": url,
            "priceCurrency": SITE["currency"],
            "price": f"{float(p['price']):.2f}",
            "priceValidUntil": valid_thru,
            "availability": "https://schema.org/" + availability_label(p["quantity"]),
            "itemCondition": "https://schema.org/NewCondition",
            "seller": {"@type": "Organization", "name": SITE["title"]},
        },
    }
    # The "missing from dataLayer" attributes:
    if p.get("description"):
        o["description"] = p["description"]
    if p.get("gtin"):
        o["gtin13"] = p["gtin"]
    if p.get("mpn"):
        o["mpn"] = p["mpn"]
    if p.get("color"):
        o["color"] = p["color"]
    if p.get("size"):
        o["size"] = p["size"]
    if p.get("material"):
        o["material"] = p["material"]
    if p.get("rating_value") and p.get("rating_count"):
        o["aggregateRating"] = {
            "@type": "AggregateRating",
            "ratingValue": p["rating_value"],
            "reviewCount": p["rating_count"],
            "bestRating": "5",
            "worstRating": "1",
        }
    return o


def breadcrumb_ld(items):
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": it["name"], "item": it["url"]}
            for i, it in enumerate(items)
        ],
    }


# ---------- pages ----------

def og_meta_standard(d):
    out = []
    for k, v in d.items():
        if v in (None, ""):
            continue
        out.append(f'  <meta property="{k}" content="{esc(v)}" />')
    return "\n".join(out)


def head_common(title, description, canonical, og_image, og_type="website"):
    og = og_meta_standard({
        "og:type": og_type, "og:title": title, "og:description": description,
        "og:url": canonical, "og:image": og_image, "og:site_name": SITE["title"],
        "og:locale": SITE["locale"],
    })
    twitter = og_meta_standard({})  # not used; using name-based below
    twitter_html = "\n".join([
        '  <meta name="twitter:card" content="summary_large_image" />',
        f'  <meta name="twitter:title" content="{esc(title)}" />',
        f'  <meta name="twitter:description" content="{esc(description)}" />',
        f'  <meta name="twitter:image" content="{esc(og_image)}" />',
    ])
    return "\n".join([
        f'  <meta name="description" content="{esc(description)}" />',
        f'  <link rel="canonical" href="{esc(canonical)}" />',
        og, twitter_html,
    ])


def build_home(products):
    title = f"{SITE['title']} — Home"
    canonical = SITE["url"] + "/"
    head = "\n".join([
        head_common(title, SITE["tagline"], canonical, abs_url(SITE["url"], SITE["logo"])),
        "  " + script_inline(dl_init()),
        "  " + script_inline("\n  ".join([
            dl_page("home", title, "/"),
            dl_list("home_grid", products),
        ])),
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
    head = "\n".join([
        head_common(title, desc, canonical, cover),
        "  " + script_inline(dl_init()),
        "  " + script_inline("\n  ".join([
            dl_page("category", title, f"/categories/{name.lower()}.html"),
            dl_list(name, products),
        ])),
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
        "  " + script_inline(dl_init()),
        "  " + script_inline("\n  ".join([
            dl_page("product", title, f"/products/{p['sku']}.html"),
            dl_product(p),
        ])),
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
        <p class="blurb">{esc(p.get('description') or '')}</p>
        <p class="muted"><small>Note: tracking fields like color, size, material, GTIN, MPN, availability and rating are not in the dataLayer for this site &mdash; they are only available via the JSON-LD on this page.</small></p>
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
    print(f"[datalayer-custom] wrote home + {len(category_pages(products))} categories"
          f" + {len(products)} products")


if __name__ == "__main__":
    main()
