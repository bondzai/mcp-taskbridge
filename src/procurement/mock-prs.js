/**
 * Reusable mock-PR generator. Pure functions — no I/O.
 *
 *   generateMockPr({ rng })           → one realistic PR object
 *   generateMockPrs({ count, rng })   → array of PRs
 *
 * Each PR matches the shape POST /api/procurement/prs accepts:
 *   { title, requestedBy, deadline, notes, lineItems: [...] }
 *
 * Used by bin/mock-prs.js, but can be called from anywhere
 * (tests, dev tools, future "Generate" button on the dashboard).
 */

const SCENARIOS = [
  {
    title: "Q{Q} office supplies restock",
    industry: "office",
    requesters: ["alice.tan", "ben.chua", "noi.s"],
    notes: "Standard quarterly replenishment. Prefer existing vendors.",
    items: [
      { material: "A4 copy paper", spec: "80gsm white, 500 sheets/ream", unit: "ream", qtyRange: [40, 120] },
      { material: "Toner cartridge", spec: "HP CF410X black", unit: "piece", qtyRange: [4, 12] },
      { material: "Whiteboard marker", spec: "assorted colors", unit: "box", qtyRange: [10, 30] },
      { material: "Sticky notes", spec: "76x76mm yellow", unit: "pad", qtyRange: [50, 200] },
      { material: "Binder clip", spec: "32mm medium", unit: "box", qtyRange: [10, 40] },
    ],
  },
  {
    title: "Construction materials — site {SITE}",
    industry: "construction",
    requesters: ["site.foreman", "proj.mgr", "buyer.k"],
    notes: "Delivery to site by deadline. Bulk pricing requested.",
    items: [
      { material: "Steel rebar", spec: "16mm Grade 60, 12m lengths", unit: "kg", qtyRange: [800, 3000] },
      { material: "Portland cement", spec: "Type I OPC 50kg bag", unit: "bag", qtyRange: [50, 250] },
      { material: "Ready-mix concrete", spec: "C35 high-strength", unit: "cubic_meter", qtyRange: [10, 60] },
      { material: "Sand (construction)", spec: "fine washed", unit: "ton", qtyRange: [5, 30] },
      { material: "Plywood sheet", spec: "18mm 4x8 ft, marine grade", unit: "sheet", qtyRange: [40, 200] },
      { material: "Steel angle", spec: "40x40x4mm bracing", unit: "meter", qtyRange: [100, 500] },
    ],
  },
  {
    title: "IT hardware refresh — {TEAM}",
    industry: "it",
    requesters: ["it.ops", "sysadmin.r"],
    notes: "Asset tagging + 3-year warranty required. Coordinate with finance for capex.",
    items: [
      { material: "Laptop", spec: "16GB RAM, 512GB SSD, business class", unit: "unit", qtyRange: [5, 30] },
      { material: "External monitor", spec: "27\" 4K IPS, USB-C input", unit: "unit", qtyRange: [5, 30] },
      { material: "Docking station", spec: "USB-C, dual 4K, PD 90W", unit: "unit", qtyRange: [5, 30] },
      { material: "Mechanical keyboard", spec: "tenkeyless, brown switch", unit: "piece", qtyRange: [5, 30] },
    ],
  },
  {
    title: "HVAC upgrade — {SITE}",
    industry: "hvac",
    requesters: ["facilities.lead", "ops.mgr"],
    notes: "Must comply with current building energy code. Schedule installation off-hours.",
    items: [
      { material: "HVAC duct", spec: "300x200mm galvanized", unit: "meter", qtyRange: [40, 200] },
      { material: "Insulation foam", spec: "25mm closed-cell", unit: "sq_meter", qtyRange: [60, 400] },
      { material: "Refrigerant", spec: "R-410A, 11.3kg cylinder", unit: "cylinder", qtyRange: [3, 15] },
      { material: "Air handling unit", spec: "10kW capacity, EC fan", unit: "unit", qtyRange: [1, 4] },
    ],
  },
  {
    title: "Lab consumables — {LAB}",
    industry: "lab",
    requesters: ["lab.tech", "qa.lead"],
    notes: "Some items have cold-chain handling requirements. Confirm with vendor before shipping.",
    items: [
      { material: "Pipette tip", spec: "200µL filtered, sterile", unit: "rack", qtyRange: [20, 100] },
      { material: "Centrifuge tube", spec: "15mL conical sterile", unit: "case", qtyRange: [5, 30] },
      { material: "Nitrile gloves", spec: "powder-free size M", unit: "box", qtyRange: [50, 200] },
      { material: "Reagent grade ethanol", spec: "absolute, 2.5L bottle", unit: "bottle", qtyRange: [4, 20] },
    ],
  },
  {
    title: "Restaurant equipment — {LOC}",
    industry: "hospitality",
    requesters: ["chef.jp", "ops.k"],
    notes: "Coordinate delivery with venue handover schedule.",
    items: [
      { material: "Commercial fridge", spec: "2-door upright, 1200L", unit: "unit", qtyRange: [1, 4] },
      { material: "Induction cooktop", spec: "5-zone, 11kW", unit: "unit", qtyRange: [1, 3] },
      { material: "Stainless prep table", spec: "1800x700mm with shelf", unit: "unit", qtyRange: [2, 8] },
      { material: "Chef knife set", spec: "8\" 10\" 6\" forged", unit: "set", qtyRange: [2, 10] },
    ],
  },
  {
    title: "Fence + bracing — {SITE}",
    industry: "construction",
    requesters: ["site.foreman", "proj.mgr"],
    notes: "Confirm hot-dip galvanized finish. Reject mill-finish.",
    items: [
      { material: "Steel pipe", spec: "2\" Schedule 40 fence posts", unit: "meter", qtyRange: [80, 300] },
      { material: "Steel angle", spec: "40x40x4mm bracing", unit: "meter", qtyRange: [100, 400] },
      { material: "Rebar tie wire", spec: "1.2mm galvanized", unit: "kg", qtyRange: [20, 80] },
    ],
  },
  {
    title: "Solar PV pilot — {SITE}",
    industry: "energy",
    requesters: ["energy.eng", "sustainability.lead"],
    notes: "Tier-1 panels only. Include warranty + datasheet in vendor response.",
    items: [
      { material: "Solar panel", spec: "550W monocrystalline", unit: "panel", qtyRange: [20, 120] },
      { material: "String inverter", spec: "10kW three-phase", unit: "unit", qtyRange: [2, 8] },
      { material: "DC isolator", spec: "1000V 32A", unit: "unit", qtyRange: [4, 16] },
      { material: "Aluminum extrusion", spec: "solar mounting rail", unit: "meter", qtyRange: [80, 400] },
    ],
  },
];

const SITES = ["Bangkok HQ", "Chiang Mai DC", "Rayong factory", "Khon Kaen warehouse", "Phuket office"];
const TEAMS = ["engineering", "sales", "ops", "data", "design"];
const LABS  = ["QA lab", "R&D lab", "biotech bench"];
const LOCS  = ["downtown branch", "airport outlet", "mall flagship"];

const QUARTERS = ["1", "2", "3", "4"];

const defaultRng = () => Math.random();

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
const between = (lo, hi, rng) => lo + Math.floor(rng() * (hi - lo + 1));
const fillVars = (s, rng) => s
  .replace("{Q}", pick(QUARTERS, rng))
  .replace("{SITE}", pick(SITES, rng))
  .replace("{TEAM}", pick(TEAMS, rng))
  .replace("{LAB}", pick(LABS, rng))
  .replace("{LOC}", pick(LOCS, rng));

export const generateMockPr = ({ rng = defaultRng, scenario = null } = {}) => {
  const tmpl = scenario || pick(SCENARIOS, rng);
  const itemCount = between(2, Math.min(6, tmpl.items.length), rng);
  // Shuffle items, take first N
  const items = [...tmpl.items]
    .map((it) => ({ it, k: rng() }))
    .sort((a, b) => a.k - b.k)
    .slice(0, itemCount)
    .map(({ it }) => ({
      materialName: it.material,
      specification: it.spec,
      quantity: between(it.qtyRange[0], it.qtyRange[1], rng),
      unit: it.unit,
    }));

  const dayMs = 86_400_000;
  const hasDeadline = rng() > 0.4;
  const deadline = hasDeadline ? Date.now() + between(7, 60, rng) * dayMs : null;

  return {
    title: fillVars(tmpl.title, rng),
    requestedBy: pick(tmpl.requesters, rng),
    deadline,
    notes: tmpl.notes,
    lineItems: items,
  };
};

export const generateMockPrs = ({ count = 5, rng = defaultRng } = {}) => {
  const out = [];
  for (let i = 0; i < count; i++) out.push(generateMockPr({ rng }));
  return out;
};

/**
 * Render a generated PR object as a realistic RFP-style plain-text
 * document. The output mimics a procurement requisition someone might
 * actually email — useful for demo'ing the "Create PR from File" flow
 * (download a doc, upload it back, watch the LLM rebuild the PR).
 */
export const renderMockPrDocument = (pr) => {
  const lines = [];
  const today = new Date().toISOString().slice(0, 10);
  const deadlineStr = pr.deadline ? new Date(pr.deadline).toISOString().slice(0, 10) : "TBD";
  const ref = `PR-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  lines.push("PURCHASE REQUISITION");
  lines.push("=====================");
  lines.push("");
  lines.push(`Reference:    ${ref}`);
  lines.push(`Issued:       ${today}`);
  lines.push(`Deadline:     ${deadlineStr}`);
  lines.push(`Requested by: ${pr.requestedBy || "anon"}`);
  lines.push("");
  lines.push(`Subject: ${pr.title}`);
  lines.push("");
  if (pr.notes) {
    lines.push("Notes:");
    lines.push("  " + pr.notes);
    lines.push("");
  }
  lines.push("LINE ITEMS");
  lines.push("----------");
  lines.push("");
  pr.lineItems.forEach((item, idx) => {
    lines.push(`${idx + 1}. ${item.materialName}`);
    if (item.specification) lines.push(`   Specification: ${item.specification}`);
    lines.push(`   Quantity:      ${item.quantity} ${item.unit}`);
    if (item.notes) lines.push(`   Notes:         ${item.notes}`);
    lines.push("");
  });
  lines.push("Please respond with pricing, lead time, and availability.");
  lines.push("");
  lines.push("---");
  lines.push("Generated for demo purposes. Mock document.");
  return lines.join("\n");
};

export const renderMockPrDocumentBundle = (prs) => {
  return prs
    .map((pr, i) => `==== Document ${i + 1}/${prs.length} ====\n\n${renderMockPrDocument(pr)}`)
    .join("\n\n\n");
};
