export const PrStatus = Object.freeze({
  DRAFT: "draft",
  PENDING_APPROVAL: "pending_approval",
  PENDING: "pending",
  PROCESSING: "processing",
  FAILED: "failed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
});

export const ItemStatus = Object.freeze({
  DRAFT: "draft",
  SOURCING: "sourcing",
  QUOTED: "quoted",
  SELECTED: "selected",
  ORDERED: "ordered",
  RECEIVED: "received",
  CANCELLED: "cancelled",
});

export const PR_TERMINAL = new Set([PrStatus.COMPLETED, PrStatus.CANCELLED]);
export const ITEM_TERMINAL = new Set([ItemStatus.RECEIVED, ItemStatus.CANCELLED]);

// Keep legacy exports for backward compatibility with existing code
export const TERMINAL_PR_STATUSES = PR_TERMINAL;
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
