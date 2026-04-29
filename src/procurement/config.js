const env = process.env;

const parseIntOr = (value, fallback) => {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
};

const parseBool = (value, fallback) => {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return fallback;
};

export const procurementConfig = Object.freeze({
  enabled: parseBool(env.PROCUREMENT_ENABLED, false),
  gcpProject: env.PROCUREMENT_GCP_PROJECT || null,
  topics: Object.freeze({
    rfqSend: env.PROCUREMENT_TOPIC_RFQ_SEND || "procurement.rfq.send",
    rfqRemind: env.PROCUREMENT_TOPIC_RFQ_REMIND || "procurement.rfq.remind",
  }),
  subscriptions: Object.freeze({
    rfqSent: env.PROCUREMENT_SUB_RFQ_SENT || "procurement.rfq.sent",
    rfqFailed: env.PROCUREMENT_SUB_RFQ_FAILED || "procurement.rfq.failed",
    rfqDelivered: env.PROCUREMENT_SUB_RFQ_DELIVERED || "procurement.rfq.delivered",
    rfqOpened: env.PROCUREMENT_SUB_RFQ_OPENED || "procurement.rfq.opened",
    vendorReplied: env.PROCUREMENT_SUB_VENDOR_REPLIED || "procurement.vendor.replied",
  }),
  minVendorsPerItem: parseIntOr(env.PROCUREMENT_MIN_VENDORS_PER_ITEM, 2),
  rfqDeadlineHours: parseIntOr(env.PROCUREMENT_RFQ_DEADLINE_HOURS, 72),
  emailServiceUrl: env.EMAIL_SERVICE_URL || null,
  emailServiceApiKey: env.EMAIL_SERVICE_API_KEY || null,
});
