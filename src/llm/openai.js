/**
 * OpenAI implementation of the LLM provider.
 * Uses the Responses API via fetch — no SDK needed.
 *
 * Env:
 *   OPENAI_API_KEY      required
 *   OPENAI_MODEL        optional, default "gpt-4o-mini"
 *   OPENAI_BASE_URL     optional, default "https://api.openai.com/v1"
 */

const EXTRACT_SYSTEM_PROMPT = [
  "You inspect a document the user uploaded and decide whether it is a",
  "purchase requisition / RFP / RFQ / quote / vendor offer. If yes,",
  "extract structured fields. If no (e.g. essay, novel, README, contract,",
  "screenshot transcription unrelated to procurement), reject it.",
  "",
  "Return STRICT JSON only — no prose, no code fences. Schema:",
  "{",
  '  "isPurchaseRequest": boolean,',
  '  "rejectionReason":   string | null  (set when isPurchaseRequest = false; one short sentence),',
  '  "title":             string,',
  '  "deadline":          number | null  (UNIX ms epoch if a date is mentioned, else null),',
  '  "notes":             string | null,',
  '  "lineItems":         [ { "materialName": string, "specification": string|null,',
  '                            "quantity": number, "unit": string, "notes": string|null } ]',
  "}",
  "",
  "Decision guide for isPurchaseRequest:",
  '  true  → document mentions items/materials to procure with quantities or specs',
  '          (purchase requisition, RFP, RFQ, vendor offer, quote, BOM).',
  '  false → no procurement intent (article, story, code, contract, manual, blank).',
  "",
  "If false: still return the schema (set lineItems=[], title=\"\", etc.)",
  "and put a one-sentence rejectionReason. Do NOT invent line items.",
  "If true: a missing field becomes null (or [] for lineItems). Quantities must be numeric.",
].join("\n");

const GENERATE_SYSTEM_PROMPT = [
  "You generate realistic mock Purchase Requisitions for a procurement demo.",
  "",
  "Return STRICT JSON only — no prose, no code fences. Top-level shape:",
  "{ \"purchaseRequests\": [PR, PR, ...] }",
  "",
  "Each PR:",
  "{",
  '  "title":       string (specific, e.g. "Q3 office supplies restock — Bangkok HQ"),',
  '  "requestedBy": string (lowercase first.last format),',
  '  "deadline":    number | null  (UNIX ms epoch, 1-3 months from now, or null),',
  '  "notes":       string  (1-2 sentences with realistic constraints/preferences),',
  '  "lineItems":   [',
  '    { "materialName": string, "specification": string,',
  '      "quantity": number (positive integer), "unit": string }',
  '  ]',
  "}",
  "",
  "Rules:",
  "- Vary across industries: office, construction, IT, HVAC, lab, hospitality, energy, manufacturing.",
  "- 2-6 line items per PR.",
  "- Use realistic units (kg, m, box, set, ream, liter, ton, piece, sheet, bag, cubic_meter).",
  "- Materials must include realistic specifications (sizes, grades, model numbers).",
  "- Don't repeat the same material across PRs in the same response.",
].join("\n");

export const createOpenAiProvider = (env) => {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const model = env.OPENAI_MODEL || "gpt-4o-mini";
  const baseUrl = env.OPENAI_BASE_URL || "https://api.openai.com/v1";

  return {
    name: "openai",
    model,

    async extractPrFromDocument(text, { filename } = {}) {
      const userMsg = filename
        ? `Filename: ${filename}\n\n---\n\n${text}`
        : text;
      const parsed = await callJson({
        baseUrl, apiKey, model,
        system: EXTRACT_SYSTEM_PROMPT,
        user: userMsg,
        temperature: 0,
      });
      return normalize(parsed);
    },

    async generatePrs({ count = 5, industryHint } = {}) {
      const userMsg = [
        `Generate ${count} mock PRs.`,
        industryHint ? `Bias the mix toward: ${industryHint}.` : "Mix industries broadly.",
        `The "deadline" field, when set, should be a UNIX ms epoch between ${Date.now() + 7 * 86_400_000} and ${Date.now() + 90 * 86_400_000}.`,
      ].join("\n");
      const parsed = await callJson({
        baseUrl, apiKey, model,
        system: GENERATE_SYSTEM_PROMPT,
        user: userMsg,
        temperature: 0.9,
      });
      const list = Array.isArray(parsed?.purchaseRequests) ? parsed.purchaseRequests : [];
      return list.map(normalize);
    },
  };
};

const callJson = async ({ baseUrl, apiKey, model, system, user, temperature }) => {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI request failed: ${res.status} ${detail}`);
  }
  const body = await res.json();
  const content = body?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty content");
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`OpenAI returned non-JSON: ${content.slice(0, 200)}`);
  }
};

const normalize = (raw) => ({
  isPurchaseRequest: raw.isPurchaseRequest === false ? false : true,
  rejectionReason: typeof raw.rejectionReason === "string" ? raw.rejectionReason.trim() : null,
  title: typeof raw.title === "string" ? raw.title.trim() : "",
  deadline: typeof raw.deadline === "number" ? raw.deadline : null,
  notes: typeof raw.notes === "string" ? raw.notes.trim() : null,
  lineItems: Array.isArray(raw.lineItems)
    ? raw.lineItems
        .filter((i) => i && typeof i.materialName === "string")
        .map((i) => ({
          materialName: i.materialName.trim(),
          specification: typeof i.specification === "string" ? i.specification.trim() : null,
          quantity: Number(i.quantity) || 1,
          unit: typeof i.unit === "string" && i.unit.trim() ? i.unit.trim() : "unit",
          notes: typeof i.notes === "string" ? i.notes.trim() : null,
        }))
    : [],
});
