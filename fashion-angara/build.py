#!/usr/bin/env python3
"""fashion Angara — variant 4.

Mimics the Angara.com tracking pattern:
  - OpenGraph present on every page, but og:type = "website" even on PDP.
  - No product:price / product:availability / og:type=product meta.
  - Twitter Card uses "summary" (not summary_large_image) with twitter:site.
  - Custom dataLayer events:
      sessionStart, OneTrustLoaded, OptanonLoaded, adobeLoaded, rsLoaded,
      gtm.js / gtm.dom / gtm.load, pageReady, pageLoad, interaction
  - pageLoad on PDP carries a rich data.product object with jewelry-
    specific fields (sku, variantSku, blueprintId, metalType, stoneName,
    stoneShape, totalCaratWeight, centerStoneWeight, ringSize, tags ...).
  - NO `ecommerce:` key anywhere — standard GA4 Enhanced Ecommerce would
    not pick anything up without a custom GTM mapping.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _lib import (  # noqa: E402
    abs_url, category_pages, esc, jsonld_block, page_shell,
    product_card_jewelry, read_catalog, script_inline, write,
)

ROOT = os.path.dirname(os.path.abspath(__file__))
CATALOG = os.path.join(ROOT, "catalog.csv")

SITE = {
    "title": "fashion Angara",
    "tagline": "Fine jewelry — rings, earrings, bracelets and necklaces.",
    "url": "https://fashion-angara.example",
    "logo": "/images/hero-banner.png",
    "currency": "USD",
    "locale": "en_US",
    "twitter_handle": "@FashionAngara",
    "store_id": "us",
    "gtm_id": "GTM-FASHIONJWL",
}

NAV = [("Rings", "categories/rings.html"),
       ("Earrings", "categories/earrings.html"),
       ("Bracelets", "categories/bracelets.html"),
       ("Necklaces", "categories/necklaces.html")]


# ---------- dataLayer (Angara-style, NO `ecommerce:` key) ----------

def dl_bootstrap_events():
    """Push the pre-product-context bootstrap events Angara fires
    before any pageLoad: sessionStart, consent libs, adobe, gtm.*"""
    events = [
        {"event": "sessionStart",
         "visitor": {"id": "anon-" + "x" * 16, "isLoggedIn": False, "type": "guest"},
         "session": {"id": "sess-" + "y" * 16, "isNew": True}},
        {"event": "OneTrustLoaded"},
        {"event": "OptanonLoaded", "OnetrustActiveGroups": ",C0001,C0002,C0003,C0004,"},
        {"event": "adobeLoaded"},
        {"event": "rsLoaded"},
        {"event": "gtm.js", "gtm.start": 1700000000000},
        {"event": "gtm.dom"},
        {"event": "gtm.load"},
    ]
    pushes = "\n  ".join(
        f"window.dataLayer.push({json.dumps(e, ensure_ascii=False)});" for e in events
    )
    return "window.dataLayer = window.dataLayer || [];\n  " + pushes


def dl_page_ready(page_type, path, page_title):
    """pageReady has page/store context only — no product."""
    payload = {
        "event": "pageReady",
        "page": {"type": page_type, "path": path, "title": page_title},
        "store": {"id": SITE["store_id"], "currency": SITE["currency"], "locale": SITE["locale"]},
    }
    return f"window.dataLayer.push({json.dumps(payload, ensure_ascii=False)});"


def dl_page_load(page_type, path, page_title, product=None, listing=None):
    """pageLoad mirrors pageReady but carries product / listing context."""
    data = {"page": {"type": page_type, "path": path, "title": page_title},
            "store": {"id": SITE["store_id"], "currency": SITE["currency"]}}
    if product is not None:
        data["product"] = product
    if listing is not None:
        data["listing"] = listing
    payload = {"event": "pageLoad", "data": data}
    return f"window.dataLayer.push({json.dumps(payload, ensure_ascii=False)});"


def angara_product_obj(p):
    """The fat `data.product` object Angara emits on PDP."""
    url = f"{SITE['url']}/products/{p['sku']}.html"
    tags = {
        "birthstone": [p["birthstone"]] if p.get("birthstone") else [],
        "collections": [p["collection"]] if p.get("collection") else [],
        "occasion": p["occasion"].split("|") if p.get("occasion") else [],
        "metalTypes": [p["metalType"]] if p.get("metalType") else [],
        "stoneTypes": [p["stoneName"]] if p.get("stoneName") else [],
        "stoneShapes": [p["stoneShape"]] if p.get("stoneShape") else [],
    }
    return {
        "sku": p["sku"],
        "variantSku": p["variantSku"],
        "defaultVariantSku": p["defaultVariantSku"],
        "blueprintId": p["blueprintId"],
        "name": p["name"],
        "imageURL": p["imageURL"],
        "url": url,
        "priceIncTax": float(p["priceIncTax"]),
        "priceDiscount": float(p["priceDiscount"] or 0),
        "promotionType": p.get("promotionType") or None,
        "metalType": p.get("metalType") or "",
        "stoneName": p.get("stoneName") or "",
        "stoneType": p.get("stoneType") or "",
        "stoneShape": p.get("stoneShape") or "",
        "stoneQuality": p.get("stoneQuality") or "",
        "jewelryType": p.get("jewelryType") or "",
        "productType": p.get("productType") or "",
        "totalCaratWeight": float(p["totalCaratWeight"]) if p.get("totalCaratWeight") else None,
        "centerStoneWeight": float(p["centerStoneWeight"]) if p.get("centerStoneWeight") else None,
        "ringSize": p.get("ringSize") or None,
        "rating": float(p["rating"]) if p.get("rating") else None,
        "reviewCount": int(p["reviewCount"]) if p.get("reviewCount") else 0,
        "isSalable": (p.get("isSalable") or "").lower() == "true",
        "leadTime": p.get("leadTime") or "",
        "emi": (p.get("emi") or "").lower() == "true",
        "tags": tags,
    }


def angara_listing_obj(name, products):
    return {
        "category": name,
        "itemCount": len(products),
        "items": [
            {"sku": p["sku"], "name": p["name"],
             "priceIncTax": float(p["priceIncTax"]),
             "metalType": p.get("metalType") or "",
             "stoneName": p.get("stoneName") or ""}
            for p in products
        ],
    }


# ---------- JSON-LD (standard schema.org) ----------

def organization_ld():
    return {"@context": "https://schema.org", "@type": "Organization",
            "name": SITE["title"], "url": SITE["url"],
            "logo": abs_url(SITE["url"], SITE["logo"]),
            "description": SITE["tagline"]}


def product_ld(p):
    url = f"{SITE['url']}/products/{p['sku']}.html"
    o = {
        "@context": "https://schema.org", "@type": "Product",
        "@id": url + "#product",
        "name": p["name"], "sku": p["sku"], "url": url,
        "image": [p["imageURL"]],
        "brand": {"@type": "Brand", "name": p["brand"]},
        "description": p["description"],
        "offers": {
            "@type": "Offer", "url": url,
            "priceCurrency": SITE["currency"],
            "price": f"{float(p['priceIncTax']):.2f}",
            "availability": "https://schema.org/InStock" if int(p["quantity"] or 0) > 0
                            else "https://schema.org/OutOfStock",
            "itemCondition": "https://schema.org/NewCondition",
            "seller": {"@type": "Organization", "name": SITE["title"]},
        },
    }
    if p.get("rating") and p.get("reviewCount"):
        o["aggregateRating"] = {"@type": "AggregateRating",
                                "ratingValue": p["rating"], "reviewCount": p["reviewCount"],
                                "bestRating": "5", "worstRating": "1"}
    return o


# ---------- pages ----------

def og_block(title, description, canonical, image):
    """Note: og:type is ALWAYS 'website', even on PDPs. No product:* tags."""
    return "\n".join([
        f'  <meta property="og:type" content="website" />',
        f'  <meta property="og:title" content="{esc(title)}" />',
        f'  <meta property="og:description" content="{esc(description)}" />',
        f'  <meta property="og:url" content="{esc(canonical)}" />',
        f'  <meta property="og:site_name" content="{esc(SITE["title"])}" />',
        f'  <meta property="og:image" content="{esc(image)}" />',
    ])


def twitter_block(title, description, image):
    """Twitter card = 'summary' (small thumbnail), with twitter:site."""
    return "\n".join([
        '  <meta name="twitter:card" content="summary" />',
        f'  <meta name="twitter:site" content="{esc(SITE["twitter_handle"])}" />',
        f'  <meta name="twitter:title" content="{esc(title)}" />',
        f'  <meta name="twitter:description" content="{esc(description)}" />',
        f'  <meta name="twitter:image" content="{esc(image)}" />',
    ])


def gtm_head():
    js = ("(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':"
          "new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],"
          "j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src="
          "'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);"
          "})(window,document,'script','dataLayer','" + SITE["gtm_id"] + "');")
    return f"  <!-- Google Tag Manager -->\n  <script>{js}</script>\n  <!-- End Google Tag Manager -->"


def gtm_noscript():
    return (
        f'  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id={SITE["gtm_id"]}" '
        'height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>'
    )


def head_for(title, description, canonical, image, dl_inline):
    return "\n".join([
        f'  <meta name="description" content="{esc(description)}" />',
        f'  <link rel="canonical" href="{esc(canonical)}" />',
        og_block(title, description, canonical, image),
        twitter_block(title, description, image),
        gtm_head(),
        "  " + script_inline(dl_inline),
    ])


def build_home(products):
    title = f"{SITE['title']} — Fine Jewelry"
    canonical = SITE["url"] + "/"
    image = abs_url(SITE["url"], SITE["logo"])
    dl = "\n  ".join([
        dl_bootstrap_events(),
        dl_page_ready("home", "/", title),
        dl_page_load("home", "/", title, listing=angara_listing_obj("home", products)),
    ])
    head = "\n".join([
        head_for(title, SITE["tagline"], canonical, image, dl),
        "  " + jsonld_block(organization_ld()),
    ])
    cards = "\n".join(product_card_jewelry(p) for p in products)
    body = f"""    <section class="hero">
      <h1>{esc(SITE['title'])}</h1>
      <p>{esc(SITE['tagline'])}</p>
    </section>
    <section class="grid">
{cards}
    </section>"""
    return page_shell(title=title, head_extra=head, body=body, base_prefix="",
                      brand_label=SITE["title"], nav=NAV,
                      body_prefix_html=gtm_noscript())


def build_category(name, products):
    title = f"{name} — {SITE['title']}"
    canonical = f"{SITE['url']}/categories/{name.lower()}.html"
    desc = f"{name} from {SITE['title']} — {len(products)} pieces."
    image = products[0]["imageURL"] if products else abs_url(SITE["url"], SITE["logo"])
    dl = "\n  ".join([
        dl_bootstrap_events(),
        dl_page_ready("category", f"/categories/{name.lower()}.html", title),
        dl_page_load("category", f"/categories/{name.lower()}.html", title,
                     listing=angara_listing_obj(name, products)),
    ])
    head = head_for(title, desc, canonical, image, dl)
    cards = "\n".join(product_card_jewelry(p, base_prefix="../") for p in products)
    body = f"""    <section class="page-head">
      <h1>{esc(name)}</h1>
      <p class="muted">{esc(desc)}</p>
    </section>
    <section class="grid">
{cards}
    </section>"""
    return page_shell(title=title, head_extra=head, body=body, base_prefix="../",
                      brand_label=SITE["title"], nav=NAV,
                      body_prefix_html=gtm_noscript())


def build_product(p):
    title = f"{p['name']} — {SITE['title']}"
    canonical = f"{SITE['url']}/products/{p['sku']}.html"
    desc = p["description"]
    image = p["imageURL"]
    dl = "\n  ".join([
        dl_bootstrap_events(),
        dl_page_ready("product", f"/products/{p['sku']}.html", title),
        dl_page_load("product", f"/products/{p['sku']}.html", title,
                     product=angara_product_obj(p)),
    ])
    head = "\n".join([
        head_for(title, desc, canonical, image, dl),
        "  " + jsonld_block(product_ld(p)),
    ])
    body = f"""    <article class="product-detail">
      <div class="gallery">
        <img src="{esc(image)}" alt="{esc(p['name'])}" />
      </div>
      <div class="info">
        <p class="crumbs"><a href="../index.html">Home</a> / <a href="../categories/{p['category_1'].lower()}.html">{esc(p['category_1'])}</a> / {esc(p['name'])}</p>
        <h1>{esc(p['name'])}</h1>
        <p class="brand">{esc(p['metalType'])} &middot; {esc(p['stoneName'])} ({esc(p['stoneShape'])})</p>
        <p class="price">USD {float(p['priceIncTax']):,.2f}</p>
        <dl class="attrs">
          <dt>SKU</dt><dd>{esc(p['sku'])}</dd>
          <dt>Metal</dt><dd>{esc(p['metalType'])}</dd>
          <dt>Stone</dt><dd>{esc(p['stoneName'])} ({esc(p['stoneShape'])})</dd>
          <dt>Total carats</dt><dd>{esc(p.get('totalCaratWeight') or '-')}</dd>
          <dt>Center stone</dt><dd>{esc(p.get('centerStoneWeight') or '-')}</dd>
          <dt>Lead time</dt><dd>{esc(p['leadTime'])}</dd>
        </dl>
        <p class="blurb">{esc(desc)}</p>
        <p class="muted"><small>Tracking note: this page emits Angara-style custom events
        (pageLoad/pageReady/sessionStart) with a fat data.product object. No standard GA4
        ecommerce key is present.</small></p>
      </div>
    </article>"""
    return page_shell(title=title, head_extra=head, body=body, base_prefix="../",
                      brand_label=SITE["title"], nav=NAV,
                      body_prefix_html=gtm_noscript())


def main():
    products = read_catalog(CATALOG)
    write(os.path.join(ROOT, "index.html"), build_home(products))
    for name, items in category_pages(products).items():
        write(os.path.join(ROOT, "categories", name.lower() + ".html"),
              build_category(name, items))
    for p in products:
        write(os.path.join(ROOT, "products", p["sku"] + ".html"), build_product(p))
    print(f"[angara] wrote home + {len(category_pages(products))} categories"
          f" + {len(products)} products")


if __name__ == "__main__":
    main()
