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
      res.setHeader("cf-cache-status", "DYNAMIC");
      // Disable compression — Cloud Run/nginx may buffer compressed chunks
      res.setHeader("Content-Encoding", "identity");
      res.flushHeaders?.();
      res.write(format("ready", { ok: true }));
      res.flush?.();
      clients.add(res);
      const keepalive = setInterval(() => {
        try { res.write(": keepalive\n\n"); res.flush?.(); } catch { clearInterval(keepalive); }
      }, 15_000);
      res.on("close", () => { clearInterval(keepalive); clients.delete(res); });
    },
    broadcast(event, data) {
      const chunk = format(event, data);
      for (const client of clients) {
        try {
          client.write(chunk);
          client.flush?.();
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
