/**
 * Build RFQ email payloads from decision engine output.
 * One payload per vendor, items merged per vendor.
 * This is the contract between Core Service and Email Service.
 */
import { randomUUID } from "node:crypto";

export const buildRfqPayloads = ({ pr, rfqPlan, lineItems, vendors }) => {
  const vendorMap = new Map(vendors.map(v => [v.id, v]));
  const itemMap = new Map(lineItems.map(i => [i.id, i]));

  return rfqPlan.map(plan => {
    const vendor = vendorMap.get(plan.vendorId);
    const items = (plan.items || plan.lineItemIds || []).map(ref => {
      const itemId = typeof ref === "object" ? ref.lineItemId : ref;
      const item = itemMap.get(itemId);
      const price = typeof ref === "object" ? ref.referencePrice : plan.referencePrice;
      if (!item) return null;
      return {
        lineItemId: item.id,
        materialName: item.materialName,
        specification: item.specification || null,
        quantity: item.quantity,
        unit: item.unit,
        referencePrice: price ?? item.referencePrice ?? null,
        hasReferencePrice: (price ?? item.referencePrice) != null,
      };
    }).filter(Boolean);

    const totalEstimatedValue = items.reduce((sum, i) =>
      sum + (i.hasReferencePrice ? i.referencePrice * i.quantity : 0), 0
    );

    return {
      rfqId: randomUUID(),
      prId: pr.id,
      prTitle: pr.title,
      requestedBy: pr.requestedBy || null,
      deadline: pr.deadline || null,

      vendor: {
        id: vendor?.id || plan.vendorId,
        name: vendor?.name || null,
        email: vendor?.email || null,
        phone: vendor?.phone || null,
        address: vendor?.address || null,
        currency: vendor?.currency || "USD",
        leadTimeDays: vendor?.leadTimeDays || null,
      },

      items,

      metadata: {
        sentAt: null,
        decisionWarnings: plan.warnings || [],
        totalEstimatedValue: Math.round(totalEstimatedValue * 100) / 100,
        currency: vendor?.currency || "USD",
      },
    };
  });
};
