#!/bin/bash
# Deploy procurement-core to Cloud Run
# Usage: ./deploy.sh
#
# Requires:
#   - gcloud CLI authenticated
#   - .env.production with DATABASE_URL

set -euo pipefail

PROJECT="freeform-agents"
SERVICE="procurement-core"
REGION="asia-southeast1"

# Load env vars
if [ -f .env.production ]; then
  export $(grep -v '^#' .env.production | xargs)
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL not set. Check .env.production"
  exit 1
fi

echo "Deploying $SERVICE to $PROJECT ($REGION)..."

gcloud run deploy "$SERVICE" \
  --source . \
  --project "$PROJECT" \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars "DB_DRIVER=postgres,DATABASE_URL=${DATABASE_URL},PROCUREMENT_ENABLED=true,AUTH_SECRET=${AUTH_SECRET:-procurement-agent-prod-2026}" \
  --min-instances 1 \
  --max-instances 3 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 3600 \
  --cpu-boost \
  --session-affinity \
  --no-cpu-throttling

echo ""
echo "Deployed! Run schema + seed:"
echo "  DB_DRIVER=postgres DATABASE_URL=\$DATABASE_URL node bin/seed.js"
