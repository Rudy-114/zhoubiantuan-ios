export const logger = {
  info(event, fields = {}) {
    write("info", event, fields);
  },
  warn(event, fields = {}) {
    write("warn", event, fields);
  },
  error(event, fields = {}) {
    write("error", event, fields);
  }
};

function write(level, event, fields) {
  const payload = {
    time: new Date().toISOString(),
    level,
    event,
    ...serializeFields(fields)
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

function serializeFields(fields) {
  const serialized = {};
  for (const [key, value] of Object.entries(fields || {})) {
    serialized[key] = value instanceof Error ? serializeError(value) : value;
  }
  return serialized;
}

function serializeError(error) {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack
  };
}
