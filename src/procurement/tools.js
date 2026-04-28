import { z } from "zod";
import { ValidationError, NotFoundError, ConflictError } from "../core/service.js";

const ok = (payload) => ({
  content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
});

const err = (message, code = "INTERNAL") => ({
  isError: true,
  content: [{ type: "text", text: JSON.stringify({ error: message, code }) }],
});

const toError = (e) => {
  if (e instanceof ValidationError) return err(e.message, "VALIDATION");
  if (e instanceof NotFoundError) return err(e.message, "NOT_FOUND");
  if (e instanceof ConflictError) return err(e.message, "CONFLICT");
  return err(e?.message ?? "unknown error", "INTERNAL");
};

export const createProcurementToolHandlers = ({ service }) => {
  const wrap = (fn) => async (args) => {
    try {
      return ok(await fn(args ?? {}));
    } catch (e) {
      return toError(e);
    }
  };

  return {
    searchVendors: wrap(async ({ query, category, limit }) => {
      const vendors = service.searchVendors(query, category, limit);
      return { count: vendors.length, vendors };
    }),

    getVendorDetails: wrap(async ({ vendor_id }) => {
      return service.getVendor(vendor_id);
    }),

    getPurchaseRequest: wrap(async ({ pr_id }) => {
      return service.getPr(pr_id);
    }),

    getPrLineItems: wrap(async ({ pr_id }) => {
      const pr = service.getPr(pr_id);
      return { prId: pr_id, lineItems: pr.lineItems || [] };
    }),

    listVendorMaterials: wrap(async ({ vendor_id }) => {
      const materials = service.listVendorMaterials(vendor_id);
      return { vendorId: vendor_id, count: materials.length, materials };
    }),

    submitVendorShortlist: wrap(async ({ pr_id, shortlist }) => {
      const result = await service.submitShortlist(pr_id, shortlist);
      return { ok: true, pr: result.pr, shortlist: result.shortlist };
    }),

    getPurchaseHistory: wrap(async ({ material_name, vendor_id, limit }) => {
      const history = service.getPurchaseHistory({
        materialName: material_name,
        vendorId: vendor_id,
        limit: limit ?? 20,
      });
      return { count: history.length, history };
    }),
  };
};

export const procurementToolDefinitions = (handlers) => [
  {
    name: "search_vendors",
    config: {
      title: "Search Vendors",
      description:
        "Search the vendor knowledge base by material name or category. " +
        "Returns active vendors that supply matching materials.",
      inputSchema: {
        query: z.string().optional().describe("Material name or keyword to search for"),
        category: z.string().optional().describe("Material category to filter by"),
        limit: z.number().int().positive().max(100).optional()
          .describe("Max results (default 20)"),
      },
    },
    run: (args) => handlers.searchVendors(args ?? {}),
  },
  {
    name: "get_vendor_details",
    config: {
      title: "Get Vendor Details",
      description:
        "Fetch full details of a vendor including all materials they supply.",
      inputSchema: {
        vendor_id: z.string().describe("Vendor id"),
      },
    },
    run: (args) => handlers.getVendorDetails(args),
  },
  {
    name: "get_purchase_request",
    config: {
      title: "Get Purchase Request",
      description:
        "Fetch full details of a purchase request including line items, shortlist, and RFQ status.",
      inputSchema: {
        pr_id: z.string().describe("Purchase request id"),
      },
    },
    run: (args) => handlers.getPurchaseRequest(args),
  },
  {
    name: "get_pr_line_items",
    config: {
      title: "Get PR Line Items",
      description:
        "Fetch just the line items for a purchase request. Use this to understand what materials need sourcing.",
      inputSchema: {
        pr_id: z.string().describe("Purchase request id"),
      },
    },
    run: (args) => handlers.getPrLineItems(args),
  },
  {
    name: "list_vendor_materials",
    config: {
      title: "List Vendor Materials",
      description:
        "List all materials supplied by a specific vendor, including reference prices and units.",
      inputSchema: {
        vendor_id: z.string().describe("Vendor id"),
      },
    },
    run: (args) => handlers.listVendorMaterials(args),
  },
  {
    name: "submit_vendor_shortlist",
    config: {
      title: "Submit Vendor Shortlist",
      description:
        "Submit a vendor shortlist for a purchase request. This transitions the PR from " +
        "sourcing to sourced. Each entry maps a vendor to a line item with an optional " +
        "reference price. After submission, the decision engine validates and creates RFQ emails.",
      inputSchema: {
        pr_id: z.string().describe("Purchase request id"),
        shortlist: z.array(z.object({
          vendorId: z.string().describe("Vendor id"),
          lineItemId: z.number().int().optional().describe("Line item id (omit to cover all items)"),
          referencePrice: z.number().optional().describe("Expected unit price"),
          notes: z.string().optional().describe("Notes about this vendor for this item"),
        })).min(1).describe("Array of vendor-to-item mappings"),
      },
    },
    run: (args) => handlers.submitVendorShortlist(args),
  },
  {
    name: "get_purchase_history",
    config: {
      title: "Get Purchase History",
      description:
        "Query past completed purchases to understand pricing history and vendor performance " +
        "for a material. Use this during sourcing to make informed vendor selections.",
      inputSchema: {
        material_name: z.string().optional().describe("Fuzzy search on material name"),
        vendor_id: z.string().optional().describe("Filter to a specific vendor"),
        limit: z.number().int().positive().max(100).optional()
          .describe("Max results (default 20)"),
      },
    },
    run: (args) => handlers.getPurchaseHistory(args ?? {}),
  },
];
