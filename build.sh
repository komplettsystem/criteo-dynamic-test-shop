#!/bin/bash
set -e

# 1. Clean and prepare dist/
rm -rf dist
mkdir -p dist

# 2. Copy static site assets
cp -r assets images catalog.csv robots.txt vite.svg TESTING_GUIDE.md dist/
cp index.html dist/
cp index.html dist/404.html

# 3. Substitute GTM container ID in all HTML files (Option B single index.html)
find dist -name "*.html" -exec perl -pi -e "s/GTM_CONTAINER_ID/\$GTM_ID/g" {} +

echo "Build complete. Dynamic single root page index.html updated in dist/."
