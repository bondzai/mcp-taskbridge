export const PrStatus = Object.freeze({
  DRAFT: "draft",
  PENDING_APPROVAL: "pending_approval",
  APPROVED: "approved",
  REJECTED: "rejected",
  PENDING_SOURCING: "pending_sourcing",
  SOURCING: "sourcing",
  SOURCED: "sourced",
  RFQ_PENDING: "rfq_pending",
  RFQ_SENDING: "rfq_sending",
  RFQ_SENT: "rfq_sent",
  AWAITING_REPLIES: "awaiting_replies",
  QUOTES_RECEIVED: "quotes_received",
  ANALYSIS: "analysis",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
});

export const TERMINAL_PR_STATUSES = new Set([
  PrStatus.COMPLETED,
  PrStatus.CANCELLED,
  PrStatus.REJECTED,
]);

export const ALL_PR_STATUSES = new Set(Object.values(PrStatus));

export const RfqStatus = Object.freeze({
  PENDING: "pending",
  SENDING: "sending",
  SENT: "sent",
  SEND_FAILED: "send_failed",
  DELIVERED: "delivered",
  OPENED: "opened",
  REPLIED: "replied",
  EXPIRED: "expired",
});

export const TERMINAL_RFQ_STATUSES = new Set([
  RfqStatus.REPLIED,
  RfqStatus.EXPIRED,
  RfqStatus.SEND_FAILED,
]);

export const ALL_RFQ_STATUSES = new Set(Object.values(RfqStatus));
