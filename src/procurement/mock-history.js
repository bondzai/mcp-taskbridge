/**
 * Mock purchase history — read-only reference data.
 * Not tied to PR records. Used by the History page until we have
 * enough real completed PRs to show.
 */

const days = (d) => d * 86_400_000;
const now = Date.now();

export const MOCK_HISTORY = [
  {
    prId: "hist-2026-q1-001",
    prTitle: "Warehouse expansion — structural steel",
    completedAt: now - days(45),
    items: [
      { materialName: "Steel rebar", quantity: 2000, unit: "kg", vendorId: "v-acme", vendorName: "Acme Steel Corporation", unitPrice: 11.80, currency: "USD", leadTimeDays: 12 },
      { materialName: "Steel I-beam", quantity: 40, unit: "meter", vendorId: "v-acme", vendorName: "Acme Steel Corporation", unitPrice: 82.00, currency: "USD", leadTimeDays: 14 },
      { materialName: "Steel plate", quantity: 500, unit: "kg", vendorId: "v-metalco", vendorName: "MetalCo Industries", unitPrice: 14.20, currency: "USD", leadTimeDays: 7 },
    ],
  },
  {
    prId: "hist-2026-q1-002",
    prTitle: "Office renovation — electrical & lighting",
    completedAt: now - days(30),
    items: [
      { materialName: "Copper wire", quantity: 500, unit: "meter", vendorId: "v-wirepro", vendorName: "WirePro Electrical Ltd", unitPrice: 2.90, currency: "USD", leadTimeDays: 18 },
      { materialName: "Electrical cable", quantity: 200, unit: "meter", vendorId: "v-wirepro", vendorName: "WirePro Electrical Ltd", unitPrice: 7.80, currency: "USD", leadTimeDays: 18 },
      { materialName: "LED panel light", quantity: 24, unit: "piece", vendorId: "v-wirepro", vendorName: "WirePro Electrical Ltd", unitPrice: 26.00, currency: "USD", leadTimeDays: 21 },
      { materialName: "Junction box", quantity: 30, unit: "piece", vendorId: "v-wirepro", vendorName: "WirePro Electrical Ltd", unitPrice: 11.00, currency: "USD", leadTimeDays: 18 },
      { materialName: "PVC conduit", quantity: 100, unit: "piece", vendorId: "v-wirepro", vendorName: "WirePro Electrical Ltd", unitPrice: 4.50, currency: "USD", leadTimeDays: 18 },
    ],
  },
  {
    prId: "hist-2026-q1-003",
    prTitle: "Foundation pour — concrete & aggregate",
    completedAt: now - days(60),
    items: [
      { materialName: "Ready-mix concrete", quantity: 120, unit: "cubic_meter", vendorId: "v-buildmax", vendorName: "BuildMax Supply Co", unitPrice: 115.00, currency: "USD", leadTimeDays: 3 },
      { materialName: "Steel rebar", quantity: 3000, unit: "kg", vendorId: "v-metalco", vendorName: "MetalCo Industries", unitPrice: 11.20, currency: "USD", leadTimeDays: 6 },
      { materialName: "Sand (construction)", quantity: 50, unit: "ton", vendorId: "v-buildmax", vendorName: "BuildMax Supply Co", unitPrice: 32.00, currency: "USD", leadTimeDays: 2 },
      { materialName: "Gravel (aggregate)", quantity: 80, unit: "ton", vendorId: "v-buildmax", vendorName: "BuildMax Supply Co", unitPrice: 40.00, currency: "USD", leadTimeDays: 2 },
    ],
  },
  {
    prId: "hist-2026-q1-004",
    prTitle: "Site safety equipment — PPE restock",
    completedAt: now - days(15),
    items: [
      { materialName: "Hard hat", quantity: 50, unit: "piece", vendorId: "v-safetyplus", vendorName: "SafetyPlus Equipment", unitPrice: 20.00, currency: "USD", leadTimeDays: 2 },
      { materialName: "Safety vest", quantity: 50, unit: "piece", vendorId: "v-safetyplus", vendorName: "SafetyPlus Equipment", unitPrice: 11.00, currency: "USD", leadTimeDays: 2 },
      { materialName: "Safety goggles", quantity: 50, unit: "piece", vendorId: "v-safetyplus", vendorName: "SafetyPlus Equipment", unitPrice: 7.50, currency: "USD", leadTimeDays: 2 },
      { materialName: "Safety boots", quantity: 20, unit: "pair", vendorId: "v-safetyplus", vendorName: "SafetyPlus Equipment", unitPrice: 80.00, currency: "USD", leadTimeDays: 3 },
      { materialName: "First aid kit", quantity: 3, unit: "piece", vendorId: "v-safetyplus", vendorName: "SafetyPlus Equipment", unitPrice: 60.00, currency: "USD", leadTimeDays: 2 },
    ],
  },
  {
    prId: "hist-2026-q1-005",
    prTitle: "Plumbing rough-in — new washrooms",
    completedAt: now - days(25),
    items: [
      { materialName: "PVC pipe", quantity: 200, unit: "meter", vendorId: "v-plumbworks", vendorName: "PlumbWorks International", unitPrice: 5.50, currency: "USD", leadTimeDays: 8 },
      { materialName: "Copper pipe", quantity: 100, unit: "meter", vendorId: "v-plumbworks", vendorName: "PlumbWorks International", unitPrice: 17.00, currency: "USD", leadTimeDays: 10 },
      { materialName: "Ball valve", quantity: 40, unit: "piece", vendorId: "v-plumbworks", vendorName: "PlumbWorks International", unitPrice: 13.50, currency: "USD", leadTimeDays: 8 },
    ],
  },
  {
    prId: "hist-2025-q4-006",
    prTitle: "HVAC retrofit — server rooms",
    completedAt: now - days(95),
    items: [
      { materialName: "HVAC duct", quantity: 80, unit: "meter", vendorId: "v-plumbworks", vendorName: "PlumbWorks International", unitPrice: 38.00, currency: "USD", leadTimeDays: 9 },
      { materialName: "Insulation foam", quantity: 150, unit: "sq_meter", vendorId: "v-plumbworks", vendorName: "PlumbWorks International", unitPrice: 7.20, currency: "USD", leadTimeDays: 8 },
    ],
  },
  {
    prId: "hist-2025-q4-007",
    prTitle: "Aluminum cladding — east wing",
    completedAt: now - days(110),
    items: [
      { materialName: "Aluminum sheet", quantity: 600, unit: "sq_meter", vendorId: "v-metalco", vendorName: "MetalCo Industries", unitPrice: 46.00, currency: "USD", leadTimeDays: 7 },
      { materialName: "Aluminum extrusion", quantity: 300, unit: "meter", vendorId: "v-metalco", vendorName: "MetalCo Industries", unitPrice: 23.00, currency: "USD", leadTimeDays: 7 },
    ],
  },
];

export const filterMockHistory = ({ materialName, vendorId, limit = 50 } = {}) => {
  let result = [...MOCK_HISTORY];
  if (materialName) {
    const q = materialName.toLowerCase();
    result = result.map(pr => ({
      ...pr,
      items: pr.items.filter(i => i.materialName.toLowerCase().includes(q)),
    })).filter(pr => pr.items.length > 0);
  }
  if (vendorId) {
    result = result.map(pr => ({
      ...pr,
      items: pr.items.filter(i => i.vendorId === vendorId),
    })).filter(pr => pr.items.length > 0);
  }
  return result.slice(0, limit);
};
