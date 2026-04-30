#!/bin/bash
# Deploy procurement-core to Cloud Run
# Usage: ./deploy.sh
#
# Reads all env vars from .env.production and forwards them to Cloud Run.

set -euo pipefail

PROJECT="freeform-agents"
SERVICE="procurement-core"
REGION="asia-southeast1"
ENV_FILE=".env.production"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found"
  exit 1
fi

# Build comma-separated env list from .env.production (skip blank/comment lines)
ENV_VARS=$(grep -v '^#' "$ENV_FILE" | grep -v '^[[:space:]]*$' | paste -sd, -)

if [ -z "$ENV_VARS" ]; then
  echo "ERROR: $ENV_FILE has no env vars"
  exit 1
fi

echo "Deploying $SERVICE to $PROJECT ($REGION)..."
echo "Env vars: $(echo "$ENV_VARS" | tr ',' '\n' | cut -d= -f1 | tr '\n' ' ')"

gcloud run deploy "$SERVICE" \
  --source . \
  --project "$PROJECT" \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars "$ENV_VARS" \
  --min-instances 0 \
  --max-instances 1 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 3600 \
  --cpu-boost \
  --cpu-throttling \
  --no-session-affinity
