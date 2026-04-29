# Cloud Run Deployment

The `procurement-core` service runs on Google Cloud Run with Supabase
PostgreSQL as the database and a Cloud Function as the email service.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│             procurement-core (Cloud Run)                 │
│                                                          │
│  Express + MCP + SSE + Auth                              │
│  PORT=8080  HOST=0.0.0.0  min-instances=1                │
└──────────┬─────────────────────────────────┬─────────────┘
           │                                 │
           │ PostgreSQL (port 6543)          │ POST /rfx
           ▼                                 ▼
   ┌───────────────┐                ┌──────────────────────┐
   │   Supabase    │                │  procurement_mail_api│
   │  PostgreSQL   │                │   (Cloud Function)   │
   └───────────────┘                └──────────────────────┘
```

## Prerequisites

- gcloud CLI installed and authenticated:
  `brew install google-cloud-sdk && gcloud auth login`
- Project set: `gcloud config set project freeform-agents`
- Supabase project with database password
- Email service deployed (or use mock mode by leaving `EMAIL_SERVICE_URL` empty)

## Environment file

Create `.env.production` (gitignored — never commit):

```bash
DB_DRIVER=postgres
DATABASE_URL=postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:6543/postgres
PROCUREMENT_ENABLED=true
AUTH_SECRET=long-random-string-change-me
EMAIL_SERVICE_URL=https://asia-southeast1-PROJECT.cloudfunctions.net/procurement_mail_api/rfx
EMAIL_SERVICE_API_KEY=your-mail-service-key
```

## Deploy

```bash
./deploy.sh
```

This reads every variable from `.env.production` and forwards it to
Cloud Run via `--set-env-vars`.

Behind the scenes:

```bash
gcloud run deploy procurement-core \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --set-env-vars "$(grep -v '^#' .env.production | paste -sd,)" \
  --min-instances 1 --max-instances 3 \
  --memory 512Mi --cpu 1 --timeout 3600 \
  --cpu-boost --session-affinity --no-cpu-throttling
```

## Cloud Run config rationale

| Setting | Value | Why |
|---|---|---|
| `--min-instances 1` | 1 | Keeps a warm container; SSE can't tolerate cold starts |
| `--max-instances 3` | 3 | Conservative — Supabase free tier allows ~50 connections total |
| `--timeout 3600` | 1 hour | SSE connections are long-lived |
| `--cpu-boost` | on | Faster startup (PostgreSQL TLS handshake + schema check) |
| `--session-affinity` | on | SSE clients stick to the same instance |
| `--no-cpu-throttling` | on | CPU stays allocated even when idle (event loop, SSE keepalives) |
| `--memory 512Mi` | 512MB | Plenty for a single-instance Node.js app |

## Networking

**Important**: Supabase databases are IPv6-only by default. Cloud Run
supports IPv6 outbound, so this works in production. Local development
on IPv4-only networks needs the **Shared Pooler** URL (different host)
or a VPN.

## Updating env vars without redeploy

```bash
gcloud run services update procurement-core \
  --update-env-vars "EMAIL_SERVICE_API_KEY=new-key" \
  --project freeform-agents --region asia-southeast1
```

## Tailing logs

```bash
gcloud run services logs tail procurement-core \
  --project freeform-agents --region asia-southeast1
```

Or filter for specific events:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND
   resource.labels.service_name="procurement-core" AND
   jsonPayload.msg:"decision engine"' \
  --project freeform-agents --limit 20
```

## Rollback

```bash
# List revisions
gcloud run revisions list --service procurement-core \
  --project freeform-agents --region asia-southeast1

# Route traffic to a previous revision
gcloud run services update-traffic procurement-core \
  --to-revisions procurement-core-00009-58v=100 \
  --project freeform-agents --region asia-southeast1
```

## Production URL

```
https://procurement-core-1087425769327.asia-southeast1.run.app
```

- Login: `admin` / `admin` (mock auth — replace `AUTH_SECRET` and
  user store before going public)
- MCP endpoint for Cowork/Codex: `<URL>/mcp`
- Health: `<URL>/api/health`

## Monitoring checklist

- `/api/health` returns `{ ok: true, db: { ok: true } }` — connection alive
- Cloud Run revision shows green in console
- Supabase dashboard shows < 50 active connections
- Email service receives POSTs after a sourcing flow completes
