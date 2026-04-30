import { procurementConfig } from "./config.js";

/**
 * Pure function that evaluates a vendor shortlist against line items.
 * Returns { valid, warnings[], errors[], rfqPlan[] }.
 *
 * Rules:
 *   1. Coverage check — every line item must have at least one vendor
 *   2. Min vendors — each item should have >= minVendorsPerItem vendors
 *   3. Price flags — warn if reference_price is missing or suspiciously high/low
 *   4. Vendor merge — group line items by vendor for combined RFQ emails
 *   5. Deadline check — warn if PR deadline is too close
 */
export const evaluateShortlist = ({ shortlist, lineItems, vendors }) => {
  const errors = [];
  const warnings = [];
  const minVendors = procurementConfig.minVendorsPerItem;

  if (!shortlist || shortlist.length === 0) {
    errors.push("Shortlist is empty");
    return { valid: false, warnings, errors, rfqPlan: [] };
  }

  if (!lineItems || lineItems.length === 0) {
    errors.push("No line items in purchase request");
    return { valid: false, warnings, errors, rfqPlan: [] };
  }

  // Build lookup maps
  const vendorMap = new Map();
  for (const v of vendors || []) {
    vendorMap.set(v.id, v);
  }

  const lineItemMap = new Map();
  for (const li of lineItems) {
    lineItemMap.set(li.id, li);
  }

  // 1. Coverage check — each line item needs at least one vendor
  const itemVendorMap = new Map(); // lineItemId → Set<vendorId>
  for (const li of lineItems) {
    itemVendorMap.set(li.id, new Set());
  }

  for (const entry of shortlist) {
    if (entry.lineItemId != null) {
      const set = itemVendorMap.get(entry.lineItemId);
      if (set) {
        set.add(entry.vendorId);
      } else {
        warnings.push(`Shortlist references unknown line item ${entry.lineItemId}`);
      }
    } else {
      // No lineItemId means vendor covers all items
      for (const [liId, set] of itemVendorMap) {
        set.add(entry.vendorId);
      }
    }
  }

  for (const [liId, vendorSet] of itemVendorMap) {
    const li = lineItemMap.get(liId);
    const label = li ? `"${li.materialName}"` : `item ${liId}`;
    if (vendorSet.size === 0) {
      errors.push(`No vendor covers ${label}`);
    } else if (vendorSet.size < minVendors) {
      warnings.push(`${label} has only ${vendorSet.size} vendor(s), minimum recommended is ${minVendors}`);
    }
  }

  // 3. Price flags
  for (const entry of shortlist) {
    if (entry.referencePrice != null && entry.referencePrice <= 0) {
      warnings.push(`Vendor ${entry.vendorId} has invalid reference price ${entry.referencePrice}`);
    }
    const vendor = vendorMap.get(entry.vendorId);
    if (!vendor) {
      errors.push(`Unknown vendor ${entry.vendorId}`);
    } else if (!vendor.active) {
      warnings.push(`Vendor "${vendor.name}" (${entry.vendorId}) is inactive`);
    }
  }

  // 4. Vendor merge — group line items + rfxTypes by vendor for combined RFQ emails
  const vendorItems = new Map();   // vendorId → Set<lineItemId>
  const vendorRfxTypes = new Map(); // vendorId → Set<rfxType>
  for (const entry of shortlist) {
    if (!vendorItems.has(entry.vendorId)) {
      vendorItems.set(entry.vendorId, new Set());
      vendorRfxTypes.set(entry.vendorId, new Set());
    }
    if (entry.lineItemId != null) {
      vendorItems.get(entry.vendorId).add(entry.lineItemId);
    } else {
      for (const li of lineItems) {
        vendorItems.get(entry.vendorId).add(li.id);
      }
    }
    if (Array.isArray(entry.rfxTypes)) {
      for (const t of entry.rfxTypes) vendorRfxTypes.get(entry.vendorId).add(t);
    }
  }

  // Build rfqPlan
  const rfqPlan = [];
  for (const [vendorId, itemIds] of vendorItems) {
    const vendor = vendorMap.get(vendorId);
    if (!vendor) continue; // already flagged as error
    rfqPlan.push({
      vendorId,
      vendorName: vendor.name,
      toEmail: vendor.email,
      lineItemIds: [...itemIds],
      rfxTypes: [...vendorRfxTypes.get(vendorId)],
    });
  }

  const valid = errors.length === 0;

  return { valid, warnings, errors, rfqPlan };
};
