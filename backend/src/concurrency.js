// No unbounded waiting queue: overload fails before consuming paid provider calls.
export function concurrencyGate(max) {
  let active = 0;
  return async function run(work) {
    if (active >= max) {
      const error = new Error("服务繁忙，请稍后重试");
      error.status = 503;
      throw error;
    }
    active += 1;
    try { return await work(); }
    finally { active -= 1; }
  };
}
