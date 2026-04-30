# Webhook API

How an external service (mail service, mail-relay, vendor portal) pushes
events into procurement-core. All webhooks live under `/webhooks/` and
**bypass the dashboard auth middleware** — they're authenticated by HMAC
signature instead.

- **Base URL (prod):** `https://procurement-core-1087425769327.asia-southeast1.run.app`
- **Base URL (local):** `http://127.0.0.1:3000`

## Authentication

Each request *should* include an HMAC of the raw body:

```
X-Taskbridge-Signature: sha256=<hex-digest>
```

Computed as `HMAC-SHA256(body, secret)` where `secret = RFX_WEBHOOK_SECRET`
on the server.

> **Bring-up phase:** verification is **permissive** — the server accepts
> unsigned requests and only verifies when both the secret and the header
> are present. Tighten by removing the permissive branch once your sender
> is signing every request.

## Common response shape

```json
{ "ok": true, "...": "..." }                      // success
{ "ok": true, "duplicate": true }                 // idempotent replay
{ "error": "...", "code": "VALIDATION" }          // 400
{ "error": "rfx <id>", "code": "NOT_FOUND" }      // 404
```

---

## 1. `POST /webhooks/rfx-events`

Generic RFx-level event log (delivery, opens, replies, bounces). Audit
trail goes into `rfx_event_log`; `rfq_emails.status` is updated when
the event implies a status change.

### Request

```http
POST /webhooks/rfx-events
Content-Type: application/json
X-Taskbridge-Signature: sha256=<hex>

{
  "rfxId":      "194855f3-50ff-4443-9154-fe4751dd8553",
  "event":      "delivered" | "opened" | "replied" | "send_failed" | "bounced" | "expired",
  "occurredAt": 1714000000000,
  "vendorEmail": "sales@acmesteel.com",
  "vendorId":    "...",
  "prId":        "...",
  "detail":      { ... }
}
```

`rfxId` is the `rfq_emails.id` we generated when sending.

### Curl

```bash
curl -X POST https://procurement-core-1087425769327.asia-southeast1.run.app/webhooks/rfx-events \
  -H "Content-Type: application/json" \
  -d '{
    "rfxId":      "194855f3-50ff-4443-9154-fe4751dd8553",
    "event":      "replied",
    "occurredAt": 1714000060000,
    "detail":     { "subject": "Re: RFQ Q3", "quoteAttachment": "quote.pdf" }
  }'
```

### Response

```json
{
  "ok": true,
  "inserted": true,
  "rfqEmail": { "id": "194855f3-...", "status": "replied", "...": "..." },
  "statusChanged": true
}
```

---

## 2. `POST /webhooks/rfx-item-status`

Push a status for a specific `(rfx × item)` cell using the **new RFx-item
vocabulary** (see `docs/status-model.md`).

### Statuses

`pending_send` | `awaiting_reply` | `replied` | `expired` | `completed` | `cancelled`

### Request

```http
POST /webhooks/rfx-item-status
Content-Type: application/json
X-Taskbridge-Signature: sha256=<hex>

{
  "rfxId":      "194855f3-50ff-4443-9154-fe4751dd8553",
  "lineItemId": 144,                         // optional — null = whole RFx
  "status":     "completed",
  "occurredAt": 1714000060000,
  "detail":     { "note": "thread closed by vendor" }
}
```

### Curl

```bash
curl -X POST https://procurement-core-1087425769327.asia-southeast1.run.app/webhooks/rfx-item-status \
  -H "Content-Type: application/json" \
  -d '{
    "rfxId":      "194855f3-50ff-4443-9154-fe4751dd8553",
    "lineItemId": 144,
    "status":     "completed",
    "occurredAt": 1714000060000
  }'
```

### Response

```json
{
  "ok": true,
  "inserted": true,
  "rfqEmail": { "id": "194855f3-...", "status": "replied", "...": "..." },
  "statusChanged": true
}
```

Idempotent on `(rfxId, status, occurredAt)` — replaying the same payload
returns `{ "ok": true, "duplicate": true }`.

---

## 3. `POST /webhooks/pr-item-status`

Push a status for a specific PR line item using the **PR-item vocabulary**.
Use this when the mail service wants to short-circuit the roll-up
(e.g. it already knows every RFx for this item is closed).

### Statuses

`pending_rfx` | `rfx_complete` | `cancelled`

### Request

```http
POST /webhooks/pr-item-status
Content-Type: application/json
X-Taskbridge-Signature: sha256=<hex>

{
  "prId":       "ef2bc91c-b307-4f88-9496-4cad59c5d777",
  "lineItemId": 144,
  "status":     "rfx_complete",
  "occurredAt": 1714000060000,
  "reason":     "All vendors closed."
}
```

### Curl

```bash
curl -X POST https://procurement-core-1087425769327.asia-southeast1.run.app/webhooks/pr-item-status \
  -H "Content-Type: application/json" \
  -d '{
    "prId":       "ef2bc91c-b307-4f88-9496-4cad59c5d777",
    "lineItemId": 144,
    "status":     "rfx_complete",
    "occurredAt": 1714000060000,
    "reason":     "All vendors closed."
  }'
```

### Response

```json
{
  "ok": true,
  "item": { "id": 144, "status": "quoted", "...": "..." },
  "pr":   { "id": "ef2bc91c-...", "status": "completed", "...": "..." },
  "statusChanged": true
}
```

After the update, the server runs `recomputePrStatus()` so the PR-level
status follows automatically — and broadcasts a `pr.updated` /
`pr.completed` event over SSE for the dashboard.

---

## Quick local-test recipe

```bash
# 1. Start the server with .env.local
make dev

# 2. Pick a real (rfxId, prId, lineItemId) from your DB
sqlite3 data/tasks.db \
  "SELECT id AS rfxId, pr_id AS prId, (SELECT id FROM pr_line_items WHERE pr_id = rfq_emails.pr_id LIMIT 1) AS lineItemId
   FROM rfq_emails LIMIT 1;"

# 3. Hit the three webhooks
curl -X POST http://127.0.0.1:3000/webhooks/rfx-events \
  -H "Content-Type: application/json" \
  -d '{"rfxId":"<rfxId>","event":"replied","occurredAt":1714000060000}'

curl -X POST http://127.0.0.1:3000/webhooks/rfx-item-status \
  -H "Content-Type: application/json" \
  -d '{"rfxId":"<rfxId>","lineItemId":<lineItemId>,"status":"completed","occurredAt":1714000060000}'

curl -X POST http://127.0.0.1:3000/webhooks/pr-item-status \
  -H "Content-Type: application/json" \
  -d '{"prId":"<prId>","lineItemId":<lineItemId>,"status":"rfx_complete","occurredAt":1714000060000}'
```

---

## Error codes

| HTTP | `code`              | When                                               |
|------|---------------------|----------------------------------------------------|
| 200  | —                   | accepted (or duplicate replay)                     |
| 400  | `VALIDATION`        | missing field / unknown status enum / bad JSON     |
| 401  | —                   | bad HMAC signature (when secret + sig both present)|
| 404  | `NOT_FOUND`         | unknown `rfxId` / `prId` / `lineItemId`            |
| 500  | `INTERNAL`          | unexpected server error                            |

## Reference

- Status hierarchy: `docs/status-model.md`
- Source: `src/procurement/routes.js`, `src/procurement/service.js`,
  `src/webhook/signer.js`
