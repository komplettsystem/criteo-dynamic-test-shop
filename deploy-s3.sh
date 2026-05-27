#!/bin/bash
# ==============================================================================
# deploy-s3.sh - AWS S3 Static Website Deployer for Fashion Test Shop
# ==============================================================================
# Usage:
#   ./deploy-s3.sh <bucket-name> [aws-region] [site-url-override]
#
# Examples:
#   ./deploy-s3.sh my-fashion-test-shop
#   ./deploy-s3.sh my-fashion-test-shop us-east-1 http://my-shop.s3-website.amazonaws.com
# ==============================================================================

set -e

# --- 1. Inputs & Configuration ---
BUCKET=$1
REGION=${2:-"us-east-1"}
SITE_URL=$3

if [ -z "$BUCKET" ]; then
  echo "❌ Error: Missing S3 bucket name."
  echo "Usage: $0 <bucket-name> [aws-region] [site-url-override]"
  exit 1
fi

# Determine S3 static website domain based on region
if [ "$REGION" = "us-east-1" ]; then
  S3_WEBSITE_URL="http://${BUCKET}.s3-website-${REGION}.amazonaws.com"
else
  S3_WEBSITE_URL="http://${BUCKET}.s3-website.${REGION}.amazonaws.com"
fi

# Fallback to the computed S3 website domain if no site-url was passed
if [ -z "$SITE_URL" ]; then
  SITE_URL=$S3_WEBSITE_URL
fi

echo "=============================================================================="
echo "🛡️  AWS S3 DEPLOYER — STARTING DEPLOYMENT"
echo "=============================================================================="
echo "📍 Target Bucket  : s3://${BUCKET}"
echo "📍 AWS Region     : ${REGION}"
echo "📍 Target SITE_URL : ${SITE_URL}"
echo "=============================================================================="

# --- 2. Dynamic Compilation ---
echo "⚙️  1. Compiling static variant pages with target SITE_URL..."
export SITE_URL="$SITE_URL"
bash build.sh
echo "✓ Variant pages compiled."

# --- 3. S3 Synchronization ---
echo "🚀 2. Synchronizing dist/ folder to S3 bucket..."
aws s3 sync dist/ "s3://${BUCKET}" --delete

echo "✓ Sync complete."

# --- 4. S3 Static Web Configuration Commands ---
echo "🔧 3. Ensuring S3 Static Website Hosting is enabled..."
# Configure index and error document routing so client-side React routes fallback nicely
aws s3api put-bucket-website --bucket "$BUCKET" --website-configuration '{
    "IndexDocument": { "Suffix": "index.html" },
    "ErrorDocument": { "Key": "index.html" }
}'

echo "=============================================================================="
echo "🎉 DEPLOYMENT SUCCESSFUL!"
echo "=============================================================================="
echo "Your Fashion Test Shop has been synced and S3 website routing configured."
echo "🔗 Access your static S3 test shop here:"
echo "👉 ${S3_WEBSITE_URL}"
echo "=============================================================================="
echo "💡 Note: If you encounter an 'Access Denied' or 'Forbidden' error, ensure your"
echo "   S3 bucket has public read policy configured. You can apply it by running:"
echo ""
echo "aws s3api put-bucket-policy --bucket $BUCKET --policy '{"
echo "  \"Version\": \"2012-10-17\","
echo "  \"Statement\": [{"
echo "    \"Sid\": \"PublicReadGetObject\","
echo "    \"Effect\": \"Allow\","
echo "    \"Principal\": \"*\","
echo "    \"Action\": \"s3:GetObject\","
echo "    \"Resource\": \"arn:aws:s3:::${BUCKET}/*\""
echo "  }]"
echo "}'"
echo "=============================================================================="
