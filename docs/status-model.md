# Status model — three-layer hierarchy

The procurement workflow has **three layers**, each with its own state
machine. Statuses roll **upward**: a parent layer's status is computed
from its children.

```
PR
└── PR ITEM       (one per line item / material in the requisition)
    └── RFx ITEM  (one per (vendor × item) — the cell carrying the quote)
```

Wording rules:

- `pending_*`  — work hasn't started at this layer.
- `*_in_progress` / `awaiting_*` — work is happening at this layer.
- `completed`  — terminal "done" word, used at every layer for the
  successful outcome.
- `cancelled`  — terminal "killed" word, used at every layer.

## Statuses

### PR

| status              | meaning                                         |
|---------------------|-------------------------------------------------|
| `pending_approval`  | submitted, waiting on approver                  |
| `in_progress`       | approved; RFx flow running                      |
| `completed`         | every active item has reached `rfx_complete`    |
| `rejected`          | approver said no                                |
| `cancelled`         | killed by user                                  |

### PR item

| status         | meaning                                                      |
|----------------|--------------------------------------------------------------|
| `pending_rfx`  | item still has open RFx threads                              |
| `rfx_complete` | every active RFx item is `completed` or `cancelled`          |
| `cancelled`    | item dropped from the PR                                     |

### RFx item — `(vendor × item)` cell, driven by mail-service events

| status           | meaning                                                  |
|------------------|----------------------------------------------------------|
| `pending_send`   | row exists, email not yet sent                           |
| `awaiting_reply` | email sent / delivered, waiting on vendor                |
| `replied`        | vendor returned a quote — thread still open              |
| `expired`        | deadline passed without a reply — thread still open      |
| `completed`      | mail service declared the thread closed (manual today)   |
| `cancelled`      | RFx withdrawn                                            |

`completed`, `cancelled` are the terminal states that count toward the
parent roll-up. `replied` and `expired` are observable interim states
the mail service exposes; they do **not** trigger the parent transition
on their own — only `completed` (or `cancelled`) does.

## Roll-up rules

```
RFx item enters {completed, cancelled}
        │
        ▼
   if EVERY active RFx item under the PR item ∈ {completed, cancelled}
        ──▶ PR item.status = rfx_complete
        │
        ▼
   if EVERY active PR item under the PR ∈ {rfx_complete, cancelled}
        ──▶ PR.status = completed
```

`active` = excluding `cancelled` rows.

## State diagrams

### PR

```
                approve                  every active item rfx_complete
pending_approval ─────▶  in_progress  ────────────────────────▶  completed
       │                      │
       │ reject               │ cancel
       ▼                      ▼
    rejected              cancelled
```

### PR item

```
              every active rfx_item in {completed, cancelled}
pending_rfx  ──────────────────────────────────────▶  rfx_complete
     │
     │ user removes / agent drops
     ▼
  cancelled
```

### RFx item

```
              email sent             vendor responds
pending_send ──────────▶ awaiting_reply ─────────▶  replied
       │                       │                       │
       │                       │ deadline passes       │  mail-service
       │                       ▼                       │  closes thread
       │                    expired                    │
       │                       │  mail-service         │
       │                       │  closes thread        │
       │                       ▼                       │
       │                   completed ◀─────────────────┘
       │
       │ user / agent withdraws
       ▼
   cancelled
```

## Webhook contracts

Two endpoints let the mail service push status changes into core. Both
follow the same patterns as `/webhooks/rfx-events` (the existing event
log webhook): JSON body, permissive HMAC during bring-up, idempotent on
`(scope, id, status, occurredAt)`, and broadcast over SSE.

### `POST /webhooks/rfx-item-status`

Updates a single RFx-item cell.

```http
POST /webhooks/rfx-item-status
Content-Type: application/json
X-Taskbridge-Signature: sha256=<hex>          (optional during bring-up)

{
  "rfxId":      "94855f3-…",                  // rfq_emails.id
  "lineItemId": 144,                          // optional — null = whole RFx
  "status":     "completed",                  // any RFx-item status
  "occurredAt": 1714000000000,
  "detail":     { ... }                       // optional, free-form
}
```

Response: `200 {ok:true, rfqEmail, statusChanged}` /
`200 {ok:true, duplicate:true}` / `404` if rfxId unknown.

The status maps onto the `rfq_emails.status` column (and a row in
`rfx_event_log` for the audit trail). When a per-line-item granularity
is needed in the future, it'll be persisted in a new `pr_rfx_items`
table.

### `POST /webhooks/pr-item-status`

Updates a single PR-item row directly. Use this when the mail service
wants to short-circuit the roll-up (e.g. it already knows the whole
item's RFx round is done).

```http
POST /webhooks/pr-item-status
Content-Type: application/json
X-Taskbridge-Signature: sha256=<hex>          (optional during bring-up)

{
  "prId":       "ef2bc91c-…",
  "lineItemId": 144,
  "status":     "rfx_complete",               // pending_rfx | rfx_complete | cancelled
  "occurredAt": 1714000000000,
  "reason":     "All vendors closed."         // optional
}
```

Response: `200 {ok:true, item}` / `404` if either id is unknown /
`400` on invalid status.

After updating the item, the server runs `recomputePrStatus()` so the
PR-level status follows automatically.

### Authentication

Both webhooks live under `/webhooks/` and skip the dashboard auth
middleware. HMAC verification is **permissive** in this phase: when
`RFX_WEBHOOK_SECRET` is set AND a signature header is provided, we
verify and reject mismatches; otherwise we accept the request and log
a warning. Tighten by removing the permissive branch once the mail
service is signing every request.
