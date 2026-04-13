import { EVENT_HEADER, SIGNATURE_HEADER, signPayload } from "./signer.js";

export const createWebhookClient = ({ url, secret, fetchImpl = fetch, logger }) => {
  if (!url) throw new Error("webhook url is required");
  if (!secret) throw new Error("webhook secret is required");

  const send = async (event, data) => {
    const payload = JSON.stringify({ event, data, ts: Date.now() });
    const signature = signPayload(secret, payload);

    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SIGNATURE_HEADER]: signature,
          [EVENT_HEADER]: event,
        },
        body: payload,
      });
      if (!response.ok) {
        logger?.warn("webhook delivery non-2xx", { status: response.status, event });
        return { ok: false, status: response.status };
      }
      return { ok: true, status: response.status };
    } catch (err) {
      logger?.warn("webhook delivery failed", { error: err.message, event });
      return { ok: false, error: err.message };
    }
  };

  return { send };
};
