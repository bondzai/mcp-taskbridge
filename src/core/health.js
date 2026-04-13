import { TaskEvents } from "./events.js";

const MCP_ACTIVE_WINDOW_MS = 5 * 60 * 1000;   // ≤ 5 min → active
const MCP_IDLE_WINDOW_MS   = 60 * 60 * 1000;  // ≤ 1 h  → idle

const deriveMcpStatus = (lastAt, nowMs) => {
  if (!lastAt) return "unknown";
  const age = nowMs - lastAt;
  if (age <= MCP_ACTIVE_WINDOW_MS) return "active";
  if (age <= MCP_IDLE_WINDOW_MS) return "idle";
  return "unknown";
};

/**
 * Tracks runtime health metrics for the /api/health endpoint.
 *
 * Observes the event bus for task.* events (totalEmitted, per-event timestamps)
 * and exposes counters that the webhook sink can increment directly
 * (webhookReceived / webhookRejected / lastWebhookOkAt / lastWebhookRejectedAt).
 *
 * MCP process health is INFERRED — the web server has no direct channel to
 * bin/mcp.js. A recent signed webhook implies the MCP process is alive and
 * the shared secret is correct; absence of webhooks just means "nobody's
 * asked the MCP client to do anything recently".
 */
export const createHealthTracker = ({ events, startedAt = Date.now() } = {}) => {
  const state = {
    startedAt,
    totalEventsEmitted: 0,
    lastEventAt: {
      [TaskEvents.CREATED]: null,
      [TaskEvents.CLAIMED]: null,
      [TaskEvents.PROGRESS]: null,
      [TaskEvents.COMPLETED]: null,
      [TaskEvents.FAILED]: null,
    },
    webhook: {
      received: 0,
      rejected: 0,
      lastOkAt: null,
      lastRejectedAt: null,
    },
  };

  if (events) {
    events.subscribe((event, _data) => {
      state.totalEventsEmitted += 1;
      if (event in state.lastEventAt) {
        state.lastEventAt[event] = Date.now();
      }
    });
  }

  return {
    recordWebhookOk() {
      state.webhook.received += 1;
      state.webhook.lastOkAt = Date.now();
    },
    recordWebhookRejected() {
      state.webhook.rejected += 1;
      state.webhook.lastRejectedAt = Date.now();
    },
    snapshot({ repo, sseSize = null, version = null } = {}) {
      const now = Date.now();
      let db = { ok: false, journalMode: null, tasks: null, error: null };
      if (repo) {
        try {
          db = {
            ok: true,
            journalMode: repo.journalMode?.() ?? null,
            tasks: repo.countByStatus?.() ?? null,
            error: null,
          };
        } catch (err) {
          db = { ok: false, journalMode: null, tasks: null, error: err.message };
        }
      }

      const mcpLastAt = Math.max(
        state.lastEventAt[TaskEvents.CLAIMED] ?? 0,
        state.lastEventAt[TaskEvents.PROGRESS] ?? 0,
        state.lastEventAt[TaskEvents.COMPLETED] ?? 0,
        state.lastEventAt[TaskEvents.FAILED] ?? 0,
        state.webhook.lastOkAt ?? 0
      ) || null;

      return {
        ok: db.ok,
        version,
        uptimeMs: now - state.startedAt,
        startedAt: state.startedAt,
        db,
        sse: { subscribers: sseSize },
        events: {
          totalEmitted: state.totalEventsEmitted,
          lastCreatedAt: state.lastEventAt[TaskEvents.CREATED],
          lastClaimedAt: state.lastEventAt[TaskEvents.CLAIMED],
          lastProgressAt: state.lastEventAt[TaskEvents.PROGRESS],
          lastCompletedAt: state.lastEventAt[TaskEvents.COMPLETED],
          lastFailedAt: state.lastEventAt[TaskEvents.FAILED],
        },
        webhook: { ...state.webhook },
        mcp: {
          status: deriveMcpStatus(mcpLastAt, now),
          lastActivityAt: mcpLastAt,
          activeWindowMs: MCP_ACTIVE_WINDOW_MS,
          idleWindowMs: MCP_IDLE_WINDOW_MS,
        },
      };
    },
  };
};
