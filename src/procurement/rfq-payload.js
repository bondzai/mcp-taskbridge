/**
 * Build RFQ email payloads from decision engine output.
 * One payload per vendor, items merged per vendor.
 * This is the contract between Core Service and Email Service.
 *
 * Wire-format guarantee: every key listed in the payload schema below
 * is ALWAYS present in the JSON we send. Missing values are explicit
 * `null` (or `[]` / `0` for arrays/counts), never `undefined` — so the
 * mail service never sees a key go missing on JSON.stringify.
 *
 * `rfqEmails` (parallel to `rfqPlan` by vendorId) lets us use the persisted
 * rfq_emails.id as the rfxId so webhook callbacks can match rows directly.
 */

// Treat empty string the same as null for the wire format.
const nz = (v) => (v === undefined || v === "" ? null : v);

// Coerce anything (number / numeric string / ISO date / undefined / "")
// to a UNIX ms epoch number, or null. Mail service rejects strings,
// NaNs, and floats, so we sanitize here.
const toEpochMs = (v) => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : null;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.trunc(n);
  const parsed = Date.parse(String(v));
  return Number.isFinite(parsed) ? parsed : null;
};

export const buildRfqPayloads = ({ pr, rfqPlan, rfqEmails = [], lineItems, vendors }) => {
  const vendorMap = new Map(vendors.map(v => [v.id, v]));
  const itemMap = new Map(lineItems.map(i => [i.id, i]));
  const rfqByVendor = new Map(rfqEmails.map(r => [r.vendorId, r]));

  return rfqPlan.map(plan => {
    const vendor = vendorMap.get(plan.vendorId);
    const rfqEmail = rfqByVendor.get(plan.vendorId);
    const items = (plan.items || plan.lineItemIds || []).map(ref => {
      const itemId = typeof ref === "object" ? ref.lineItemId : ref;
      const item = itemMap.get(itemId);
      const price = typeof ref === "object" ? ref.referencePrice : plan.referencePrice;
      if (!item) return null;
      const ref$ = price ?? item.referencePrice ?? null;
      return {
        lineItemId: nz(item.id),
        materialName: nz(item.materialName),
        specification: nz(item.specification),
        quantity: nz(item.quantity),
        unit: nz(item.unit),
        referencePrice: ref$,
        hasReferencePrice: ref$ != null,
      };
    }).filter(Boolean);

    const totalEstimatedValue = items.reduce((sum, i) =>
      sum + (i.hasReferencePrice ? i.referencePrice * i.quantity : 0), 0
    );

    // Agent-supplied set of RFx types to send for this vendor.
    // When the agent doesn't decide, default to both — mail service can fan
    // out RFI + RFQ for the demo flow.
    const rfxTypes = Array.isArray(plan.rfxTypes) && plan.rfxTypes.length > 0
      ? plan.rfxTypes
      : ["RFI", "RFQ"];

    return {
      rfxId: nz(rfqEmail?.id) ?? nz(plan.vendorId),
      rfxType: "RFQ",
      rfxTypes,
      prId: nz(pr.id),
      prTitle: nz(pr.title),
      requestedBy: nz(pr.requestedBy),
      deadline: toEpochMs(pr.deadline),
      notes: nz(pr.notes),

      vendor: {
        id: nz(vendor?.id) ?? nz(plan.vendorId),
        name: nz(vendor?.name),
        email: nz(vendor?.email),
        phone: nz(vendor?.phone),
        address: nz(vendor?.address),
        currency: nz(vendor?.currency) ?? "USD",
        leadTimeDays: nz(vendor?.leadTimeDays),
      },

      items,

      metadata: {
        sentAt: null,
        decisionWarnings: Array.isArray(plan.warnings) ? plan.warnings : [],
        totalEstimatedValue: Math.round(totalEstimatedValue * 100) / 100,
        currency: nz(vendor?.currency) ?? "USD",
      },
    };
  });
};
