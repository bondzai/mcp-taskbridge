const format = (level, msg, meta) => {
  const record = { ts: new Date().toISOString(), level, msg };
  if (meta !== undefined) record.meta = meta;
  return JSON.stringify(record);
};

const write = (level, msg, meta) => {
  process.stderr.write(format(level, msg, meta) + "\n");
};

export const logger = {
  info: (msg, meta) => write("info", msg, meta),
  warn: (msg, meta) => write("warn", msg, meta),
  error: (msg, meta) => write("error", msg, meta),
  debug: (msg, meta) => {
    if (!process.env.TASKBRIDGE_DEBUG) return;
    write("debug", msg, meta);
  },
};
