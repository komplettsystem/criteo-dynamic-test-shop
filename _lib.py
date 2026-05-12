"""Shared helpers for the four variant build scripts.

Each variant (fashion-datalayer-custom, fashion-gtag, fashion-wordpress,
fashion-angara) keeps its own build.py focused on what is unique about
its tracking/metadata layer. Common rendering lives here.
"""

import csv
import html
import json
import os


def read_catalog(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def esc(s):
    return html.escape("" if s is None else str(s), quote=True)


def jsonld_block(obj, indent="  "):
    body = json.dumps(obj, ensure_ascii=False, indent=2)
    body = body.replace("\n", "\n" + indent)
    return f'<script type="application/ld+json">\n{indent}{body}\n{indent}</script>'


def script_inline(js, indent="  "):
    return f'<script>\n{indent}{js}\n{indent}</script>'


def availability_label(qty):
    n = int(qty or 0)
    if n <= 0:
        return "OutOfStock"
    if n < 5:
        return "LimitedAvailability"
    return "InStock"


def abs_url(site_url, path):
    if not path:
        return site_url
    if path.startswith("http://") or path.startswith("https://"):
        return path
    return site_url + (path if path.startswith("/") else "/" + path)


def page_shell(*, title, head_extra, body, body_class="", body_attrs="",
               base_prefix="", brand_label, nav, footer_html=None,
               body_prefix_html="", body_suffix_html=""):
    """Render the shared HTML shell.

    base_prefix: '' for root pages, '../' for pages in subfolders.
    body_class / body_attrs: WordPress variant uses these.
    body_prefix_html / body_suffix_html: variant-specific markup that
    must sit inside <body> (e.g. GTM noscript iframe).
    """
    nav_html = "\n      ".join(
        f'<a href="{base_prefix}{href}">{esc(label)}</a>' for label, href in nav
    )
    footer = footer_html if footer_html is not None else (
        f'<p>&copy; {esc(brand_label)}. Static demo site.</p>'
    )
    body_class_attr = f' class="{esc(body_class)}"' if body_class else ""
    body_attrs_str = (" " + body_attrs) if body_attrs else ""
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{esc(title)}</title>
  <link rel="icon" type="image/svg+xml" href="{base_prefix}assets/favicon.svg" />
  <link rel="stylesheet" href="{base_prefix}assets/styles.css" />
{head_extra}
</head>
<body{body_class_attr}{body_attrs_str}>
{body_prefix_html}
  <header class="site-header">
    <a class="brand" href="{base_prefix}index.html">{esc(brand_label)}</a>
    <nav class="site-nav">
      {nav_html}
    </nav>
  </header>
  <main>
{body}
  </main>
  <footer class="site-footer">
    {footer}
  </footer>
{body_suffix_html}
</body>
</html>
"""


def product_card(p, *, base_prefix="", currency="EUR"):
    img = p["image"] if p["image"].startswith("http") else base_prefix + p["image"].lstrip("/")
    return f"""    <article class="product-card">
      <a href="{base_prefix}products/{esc(p['sku'])}.html">
        <img src="{esc(img)}" alt="{esc(p['name'])}" loading="lazy" />
        <h3>{esc(p['name'])}</h3>
        <p class="muted">{esc(p['brand'])}</p>
        <p class="price">{currency} {float(p['price']):.2f}</p>
      </a>
    </article>"""


def product_card_jewelry(p, *, base_prefix=""):
    """For the jewelry catalog used by the Angara variant."""
    img = p["imageURL"]
    return f"""    <article class="product-card">
      <a href="{base_prefix}products/{esc(p['sku'])}.html">
        <img src="{esc(img)}" alt="{esc(p['name'])}" loading="lazy" />
        <h3>{esc(p['name'])}</h3>
        <p class="muted">{esc(p['metalType'])} &middot; {esc(p['stoneName'])}</p>
        <p class="price">USD {float(p['priceIncTax']):,.2f}</p>
      </a>
    </article>"""


def category_pages(products, key="category_1"):
    cats = sorted({p[key] for p in products if p.get(key)})
    return {c: [p for p in products if p[key] == c] for c in cats}


def write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
