#!/bin/bash
set -e

# 1. Clean and prepare dist/
rm -rf dist
mkdir -p dist

# 2. Copy static site assets
cp -r assets images catalog.csv robots.txt vite.svg _redirects dist/
cp index.html dist/
cp -r setup dist/

# 3. Generate variant pages (c1–c10) into dist/
node scripts/build-variants.js

# 4. Substitute GTM container ID in all HTML files
find dist -name "*.html" -exec perl -pi -e 's/GTM_CONTAINER_ID/$ENV{GTM_ID}/g' {} +

echo "Build complete. $(find dist -name '*.html' | wc -l | tr -d ' ') HTML files in dist/"
