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
        return { ok: true, mock: true, rfxId: id, statusCode: null, response: null, requestSummary: summary };
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
        logger?.error?.("email-client: send failed", { ...summary, status: res.status, error: body.error });
        return {
          ok: false, mock: false, rfxId: id,
          statusCode: res.status, response: body,
          error: body.error || `Email service returned ${res.status}`,
          requestSummary: summary,
        };
      }

      logger?.info?.("email-client: sent", { ...summary, status: res.status });
      return { ok: true, mock: false, rfxId: id, statusCode: res.status, response: body, requestSummary: summary };
    },

    async sendBatch(payloads) {
      const results = [];
      for (const payload of payloads) {
        try {
          const result = await this.sendRfx(payload);
          results.push({ ...result, payload });
        } catch (err) {
          results.push({
            ok: false,
            mock: false,
            rfxId: payload.rfxId || payload.rfqId,
            statusCode: null,
            response: null,
            error: err.message,
            requestSummary: { vendor: payload.vendor?.name, email: payload.vendor?.email, items: payload.items?.length },
            payload,
          });
        }
      }
      return results;
    },
  };
};
