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
      res.flushHeaders?.();
      res.write(format("ready", { ok: true }));
      clients.add(res);
      res.on("close", () => clients.delete(res));
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
