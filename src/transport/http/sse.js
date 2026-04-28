export const createSseBroadcaster = () => {
  const clients = new Set();

  const format = (event, data) => {
    const lines = [];
    if (event) lines.push(`event: ${event}`);
    lines.push(`data: ${JSON.stringify(data)}`);
    lines.push("", "");
    return lines.join("\n");
  };

  return {
    attach(res) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      // Cloudflare edge: disable response buffering so events stream immediately.
      res.setHeader("cf-cache-status", "DYNAMIC");
      res.flushHeaders?.();
      res.write(format("ready", { ok: true }));
      clients.add(res);
      // Periodic keepalive prevents Cloudflare (and proxies) from
      // closing idle connections. SSE spec: lines starting with ":"
      // are comments and ignored by EventSource.
      const keepalive = setInterval(() => {
        try { res.write(": keepalive\n\n"); } catch { clearInterval(keepalive); }
      }, 15_000);
      res.on("close", () => { clearInterval(keepalive); clients.delete(res); });
    },
    broadcast(event, data) {
      const chunk = format(event, data);
      for (const client of clients) {
        try {
          client.write(chunk);
        } catch {
          clients.delete(client);
        }
      }
    },
    size() {
      return clients.size;
    },
  };
};
