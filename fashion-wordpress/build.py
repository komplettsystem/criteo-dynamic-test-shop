#!/usr/bin/env python3
"""fashion WordPress — variant 3.

Mimics a WordPress + WooCommerce + Yoast SEO + GTM install:
  - <meta name="generator" content="WordPress 6.4.2">
  - Yoast-style head block (HTML comments + meta tags + JSON-LD graph)
  - WordPress body classes (home / single-product / archive ...)
  - WooCommerce-style markup (.woocommerce, .product, .summary, .price)
  - WP REST API / oEmbed / RSD / Pingback links
  - GTM container snippet + WooCommerce-style GA4 ecommerce dataLayer
"""

import json
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _lib import (  # noqa: E402
    abs_url, availability_label, category_pages, esc, jsonld_block, page_shell,
    read_catalog, script_inline, write,
)

ROOT = os.path.dirname(os.path.abspath(__file__))
CATALOG = os.path.join(os.path.dirname(ROOT), "catalog.csv")

SITE = {
    "title": "fashion WordPress",
    "tagline": "Apparel, footwear & accessories — WP/Woo demo.",
    "url": "https://fashion-wordpress.example",
    "logo": "/images/hero-banner.png",
    "currency": "EUR",
    "locale": "en_US",
    "wp_version": "6.4.2",
    "woo_version": "8.5.1",
    "yoast_version": "21.8",
    "gtm_id": "GTM-FASHIONWP",
}

NAV = [("Shop", "categories/apparel.html"),
       ("Footwear", "categories/footwear.html"),
       ("Accessories", "categories/accessories.html")]


# ---------- WP-style head ----------

def wp_head_links():
    """Standard WP discovery links (REST, oEmbed, RSD, Pingback, etc.)."""
    base = SITE["url"]
    return "\n".join([
        f'  <link rel="https://api.w.org/" href="{base}/wp-json/" />',
        f'  <link rel="alternate" type="application/json" href="{base}/wp-json/wp/v2/pages/2" />',
        f'  <link rel="EditURI" type="application/rsd+xml" title="RSD" href="{base}/xmlrpc.php?rsd" />',
        f'  <link rel="pingback" href="{base}/xmlrpc.php" />',
        f'  <link rel="https://api.w.org/" href="{base}/wp-json/" />',
        f'  <link rel="alternate" type="application/rss+xml" title="{esc(SITE["title"])} &raquo; Feed" href="{base}/feed/" />',
        f'  <meta name="generator" content="WordPress {SITE["wp_version"]}" />',
        f'  <meta name="generator" content="WooCommerce {SITE["woo_version"]}" />',
        f'  <link rel="stylesheet" id="wp-block-library-css" href="{base}/wp-includes/css/dist/block-library/style.min.css" media="all" />',
        f'  <link rel="stylesheet" id="woocommerce-general-css" href="{base}/wp-content/plugins/woocommerce/assets/css/woocommerce.css" media="all" />',
        f'  <link rel="stylesheet" id="fashion-theme-css" href="{base}/wp-content/themes/fashion/style.css" media="all" />',
    ])


def yoast_block(title, description, canonical, og_image, og_type, graph_objs):
    """Yoast SEO writes a wrapped block with HTML comments and a single
    JSON-LD @graph script. We mirror that pattern."""
    tags = [
        '  <!-- This site is optimized with the Yoast SEO plugin v' + SITE["yoast_version"] + ' - https://yoast.com/wordpress/plugins/seo/ -->',
        f'  <meta name="description" content="{esc(description)}" />',
        f'  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" />',
        f'  <link rel="canonical" href="{esc(canonical)}" />',
        f'  <meta property="og:locale" content="{esc(SITE["locale"])}" />',
        f'  <meta property="og:type" content="{esc(og_type)}" />',
        f'  <meta property="og:title" content="{esc(title)}" />',
        f'  <meta property="og:description" content="{esc(description)}" />',
        f'  <meta property="og:url" content="{esc(canonical)}" />',
        f'  <meta property="og:site_name" content="{esc(SITE["title"])}" />',
        f'  <meta property="og:image" content="{esc(og_image)}" />',
        '  <meta name="twitter:card" content="summary_large_image" />',
        f'  <meta name="twitter:title" content="{esc(title)}" />',
        f'  <meta name="twitter:description" content="{esc(description)}" />',
        f'  <meta name="twitter:image" content="{esc(og_image)}" />',
        '  ' + jsonld_block({"@context": "https://schema.org", "@graph": graph_objs}),
        '  <!-- / Yoast SEO plugin. -->',
    ]
    return "\n".join(tags)


def gtm_head():
    """GTM container <head> snippet."""
    js = ("(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':"
          "new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],"
          "j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src="
          "'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);"
          "})(window,document,'script','dataLayer','" + SITE["gtm_id"] + "');")
    return f"  <!-- Google Tag Manager -->\n  <script>{js}</script>\n  <!-- End Google Tag Manager -->"


def gtm_noscript():
    return (
        '  <!-- Google Tag Manager (noscript) -->\n'
        f'  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id={SITE["gtm_id"]}" '
        'height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>\n'
        '  <!-- End Google Tag Manager (noscript) -->'
    )


# ---------- WooCommerce-style dataLayer ----------

def wc_item(p, index=None, list_id=None, list_name=None):
    o = {
        "item_id": p["sku"], "item_name": p["name"],
        "item_brand": p["brand"], "item_category": p.get("category_1") or "",
        "item_category2": p.get("category_2") or "",
        "item_variant": p.get("variant") or "",
        "price": float(p["price"]), "currency": SITE["currency"], "quantity": 1,
    }
    if list_id: o["item_list_id"] = list_id
    if list_name: o["item_list_name"] = list_name
    if index is not None: o["index"] = index
    return o


def wc_push(event, ecommerce):
    payload = {"event": event, "ecommerce": ecommerce}
    return ("window.dataLayer = window.dataLayer || [];\n  "
            "window.dataLayer.push({ ecommerce: null });\n  "
            f"window.dataLayer.push({json.dumps(payload, ensure_ascii=False)});")


# ---------- JSON-LD graph (Yoast-style) ----------

def graph_organization():
    return {
        "@type": "Organization",
        "@id": SITE["url"] + "/#organization",
        "name": SITE["title"], "url": SITE["url"],
        "logo": {
            "@type": "ImageObject", "@id": SITE["url"] + "/#logo",
            "url": abs_url(SITE["url"], SITE["logo"]),
            "contentUrl": abs_url(SITE["url"], SITE["logo"]),
            "caption": SITE["title"],
        },
        "image": {"@id": SITE["url"] + "/#logo"},
    }


def graph_website():
    return {
        "@type": "WebSite", "@id": SITE["url"] + "/#website",
        "url": SITE["url"], "name": SITE["title"],
        "publisher": {"@id": SITE["url"] + "/#organization"},
        "inLanguage": "en-US",
    }


def graph_webpage(title, description, canonical, page_type="WebPage"):
    return {
        "@type": page_type, "@id": canonical + "#webpage",
        "url": canonical, "name": title, "description": description,
        "isPartOf": {"@id": SITE["url"] + "/#website"},
        "inLanguage": "en-US",
    }


def graph_breadcrumb(items, canonical):
    return {
        "@type": "BreadcrumbList", "@id": canonical + "#breadcrumb",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": it["name"], "item": it["url"]}
            for i, it in enumerate(items)],
    }


def graph_product(p, canonical):
    valid_thru = (datetime.utcnow() + timedelta(days=365)).date().isoformat()
    o = {
        "@type": "Product", "@id": canonical + "#product",
        "name": p["name"], "sku": p["sku"], "url": canonical,
        "image": [abs_url(SITE["url"], p["image"])],
        "brand": {"@type": "Brand", "name": p["brand"]},
        "category": " > ".join(x for x in [p.get("category_1"), p.get("category_2")] if x),
        "offers": {
            "@type": "Offer", "url": canonical,
            "priceCurrency": SITE["currency"], "price": f"{float(p['price']):.2f}",
            "priceValidUntil": valid_thru,
            "availability": "https://schema.org/" + availability_label(p["quantity"]),
            "itemCondition": "https://schema.org/NewCondition",
        },
    }
    if p.get("description"): o["description"] = p["description"]
    if p.get("gtin"):        o["gtin13"] = p["gtin"]
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


# ---------- WP markup helpers ----------

def wp_product_card(p, *, base_prefix=""):
    """WooCommerce-style product card."""
    img = p["image"] if p["image"].startswith("http") else base_prefix + p["image"].lstrip("/")
    return f"""    <li class="product type-product status-publish has-post-thumbnail">
      <a href="{base_prefix}products/{esc(p['sku'])}.html" class="woocommerce-LoopProduct-link woocommerce-loop-product__link">
        <img src="{esc(img)}" alt="{esc(p['name'])}" class="attachment-woocommerce_thumbnail wp-post-image" loading="lazy" />
        <h2 class="woocommerce-loop-product__title">{esc(p['name'])}</h2>
        <span class="price"><span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">&euro;</span>{float(p['price']):.2f}</bdi></span></span>
      </a>
    </li>"""


def build_home(products):
    title = f"{SITE['title']} — Home"
    canonical = SITE["url"] + "/"
    items = [wc_item(p, index=i, list_id="home_grid", list_name="Home grid")
             for i, p in enumerate(products[:20])]
    graph = [graph_organization(), graph_website(),
             graph_webpage(title, SITE["tagline"], canonical, page_type="CollectionPage")]
    head = "\n".join([
        wp_head_links(),
        yoast_block(title, SITE["tagline"], canonical,
                    abs_url(SITE["url"], SITE["logo"]), "website", graph),
        gtm_head(),
        "  " + script_inline(wc_push("view_item_list", {
            "item_list_id": "home_grid", "item_list_name": "Home grid", "items": items,
        })),
    ])
    cards = "\n".join(wp_product_card(p) for p in products)
    body = f"""    <article id="post-2" class="post-2 page type-page status-publish hentry">
      <div class="woocommerce columns-4">
        <header class="page-head">
          <h1 class="entry-title">{esc(SITE['title'])}</h1>
          <p>{esc(SITE['tagline'])}</p>
        </header>
        <ul class="products columns-4">
{cards}
        </ul>
      </div>
    </article>"""
    return page_shell(
        title=title, head_extra=head, body=body, base_prefix="",
        brand_label=SITE["title"], nav=NAV,
        body_class="home page-template-default page page-id-2 woocommerce-page",
        body_prefix_html=gtm_noscript(),
    )


def build_category(name, products):
    title = f"{name} — {SITE['title']}"
    canonical = f"{SITE['url']}/categories/{name.lower()}.html"
    desc = f"Shop the {name} collection at {SITE['title']}."
    cover = abs_url(SITE["url"], products[0]["image"] if products else SITE["logo"])
    list_id = f"cat_{name.lower()}"
    items = [wc_item(p, index=i, list_id=list_id, list_name=name)
             for i, p in enumerate(products[:50])]
    graph = [
        graph_organization(), graph_website(),
        graph_webpage(title, desc, canonical, page_type="CollectionPage"),
        graph_breadcrumb([
            {"name": "Home", "url": SITE["url"] + "/"},
            {"name": name, "url": canonical}], canonical),
    ]
    head = "\n".join([
        wp_head_links(),
        yoast_block(title, desc, canonical, cover, "website", graph),
        gtm_head(),
        "  " + script_inline(wc_push("view_item_list", {
            "item_list_id": list_id, "item_list_name": name, "items": items,
        })),
    ])
    cards = "\n".join(wp_product_card(p, base_prefix="../") for p in products)
    body = f"""    <header class="page-head woocommerce-products-header">
      <h1 class="woocommerce-products-header__title page-title">{esc(name)}</h1>
      <p class="muted">{esc(desc)}</p>
    </header>
    <ul class="products columns-4">
{cards}
    </ul>"""
    cat_slug = name.lower()
    return page_shell(
        title=title, head_extra=head, body=body, base_prefix="../",
        brand_label=SITE["title"], nav=NAV,
        body_class=f"archive tax-product_cat term-{cat_slug} woocommerce woocommerce-page",
        body_prefix_html=gtm_noscript(),
    )


def build_product(p):
    title = f"{p['name']} — {p['brand']} | {SITE['title']}"
    canonical = f"{SITE['url']}/products/{p['sku']}.html"
    desc = p.get("description") or f"{p['name']} by {p['brand']}"
    img_abs = abs_url(SITE["url"], p["image"])
    img_rel = p["image"] if p["image"].startswith("http") else "../" + p["image"].lstrip("/")
    cat = p.get("category_1") or "Catalog"
    graph = [
        graph_organization(), graph_website(),
        graph_webpage(title, desc, canonical, page_type="ItemPage"),
        graph_breadcrumb([
            {"name": "Home", "url": SITE["url"] + "/"},
            {"name": cat, "url": f"{SITE['url']}/categories/{cat.lower()}.html"},
            {"name": p["name"], "url": canonical}], canonical),
        graph_product(p, canonical),
    ]
    head = "\n".join([
        wp_head_links(),
        yoast_block(title, desc, canonical, img_abs, "product", graph),
        gtm_head(),
        "  " + script_inline(wc_push("view_item", {
            "currency": SITE["currency"], "value": float(p["price"]),
            "items": [wc_item(p)],
        })),
    ])
    post_id = abs(hash(p["sku"])) % 9000 + 1000
    body = f"""    <article id="post-{post_id}" class="post-{post_id} product type-product status-publish has-post-thumbnail">
      <div class="product woocommerce">
        <nav class="woocommerce-breadcrumb">
          <a href="../index.html">Home</a> &raquo; <a href="../categories/{cat.lower()}.html">{esc(cat)}</a> &raquo; {esc(p['name'])}
        </nav>
        <div class="woocommerce-product-gallery">
          <img src="{esc(img_rel)}" alt="{esc(p['name'])}" class="wp-post-image" />
        </div>
        <div class="summary entry-summary">
          <h1 class="product_title entry-title">{esc(p['name'])}</h1>
          <p class="brand">By {esc(p['brand'])}</p>
          <p class="price">
            <span class="woocommerce-Price-amount amount">
              <bdi><span class="woocommerce-Price-currencySymbol">&euro;</span>{float(p['price']):.2f}</bdi>
            </span>
          </p>
          <div class="woocommerce-product-details__short-description">
            <p>{esc(desc)}</p>
          </div>
          <div class="product_meta">
            <span class="sku_wrapper">SKU: <span class="sku">{esc(p['sku'])}</span></span>
            <span class="posted_in">Category: <a href="../categories/{cat.lower()}.html">{esc(cat)}</a></span>
          </div>
        </div>
      </div>
    </article>"""
    return page_shell(
        title=title, head_extra=head, body=body, base_prefix="../",
        brand_label=SITE["title"], nav=NAV,
        body_class=f"single single-product postid-{post_id} woocommerce woocommerce-page",
        body_prefix_html=gtm_noscript(),
    )


def main():
    products = read_catalog(CATALOG)
    write(os.path.join(ROOT, "index.html"), build_home(products))
    for name, items in category_pages(products).items():
        write(os.path.join(ROOT, "categories", name.lower() + ".html"),
              build_category(name, items))
    for p in products:
        write(os.path.join(ROOT, "products", p["sku"] + ".html"), build_product(p))
    print(f"[wordpress] wrote home + {len(category_pages(products))} categories"
          f" + {len(products)} products")


if __name__ == "__main__":
    main()
