/**
 * OpenAI implementation of the LLM provider.
 * Uses the Responses API via fetch — no SDK needed.
 *
 * Env:
 *   OPENAI_API_KEY      required
 *   OPENAI_MODEL        optional, default "gpt-4o-mini"
 *   OPENAI_BASE_URL     optional, default "https://api.openai.com/v1"
 */

const SYSTEM_PROMPT = [
  "You are a procurement assistant. The user pastes the contents of a purchase",
  "requisition document (PDF text or plain text). Extract a structured PR.",
  "",
  "Return STRICT JSON only — no prose, no code fences. Schema:",
  "{",
  '  "title":      string (short — what is being procured),',
  '  "deadline":   number | null  (UNIX ms epoch if a date is mentioned, else null),',
  '  "notes":      string | null  (constraints, budget, contact, special instructions),',
  '  "lineItems":  [ { "materialName": string, "specification": string|null,',
  '                    "quantity": number, "unit": string, "notes": string|null } ]',
  "}",
  "",
  "If a field is missing from the document, use null (or [] for lineItems).",
  "Quantities must be numeric. Units default to \"unit\" if unclear.",
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

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMsg },
          ],
          response_format: { type: "json_object" },
          temperature: 0,
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`OpenAI request failed: ${res.status} ${detail}`);
      }
      const body = await res.json();
      const content = body?.choices?.[0]?.message?.content;
      if (!content) throw new Error("OpenAI returned empty content");

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new Error(`OpenAI returned non-JSON: ${content.slice(0, 200)}`);
      }
      return normalize(parsed);
    },
  };
};

const normalize = (raw) => ({
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
