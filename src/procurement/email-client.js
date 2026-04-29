/**
 * HTTP client for sending RFx payloads to the email service.
 *
 * Config:
 *   EMAIL_SERVICE_URL     — full URL (e.g. https://.../procurement_mail_api/rfx)
 *   EMAIL_SERVICE_API_KEY — value for X-API-Key header
 *
 * If EMAIL_SERVICE_URL is not set, payloads are logged but not sent (mock mode).
 */

export const createEmailClient = ({ url, apiKey, logger }) => {
  const isMock = !url;

  return {
    isMock,

    async sendRfx(payload) {
      const id = payload.rfxId || payload.rfqId;
      const summary = {
        rfxId: id,
        rfxType: payload.rfxType || "RFQ",
        vendor: payload.vendor?.name,
        email: payload.vendor?.email,
        items: payload.items?.length,
        totalValue: payload.metadata?.totalEstimatedValue,
      };

      if (isMock) {
        logger?.info?.("email-client [MOCK]: would send", summary);
        return { ok: true, mock: true, rfxId: id };
      }

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "X-API-Key": apiKey } : {}),
        },
        body: JSON.stringify(payload),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        const err = new Error(body.error || `Email service returned ${res.status}`);
        err.status = res.status;
        err.body = body;
        logger?.error?.("email-client: send failed", { ...summary, status: res.status, error: body.error });
        throw err;
      }

      logger?.info?.("email-client: sent", { ...summary, status: res.status });
      return { ok: true, mock: false, rfxId: id, response: body };
    },

    async sendBatch(payloads) {
      const results = [];
      for (const payload of payloads) {
        try {
          const result = await this.sendRfx(payload);
          results.push(result);
        } catch (err) {
          results.push({ ok: false, rfxId: payload.rfxId || payload.rfqId, error: err.message });
        }
      }
      return results;
    },
  };
};
