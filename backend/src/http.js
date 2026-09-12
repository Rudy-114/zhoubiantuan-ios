export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve().then(() => handler(req, res, next)).catch(next);
}

export function isDatabaseUnavailable(error) {
  return ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', '57P01', '57P02', '57P03', '53300', '57014'].includes(error?.code)
    || String(error?.code || '').startsWith('08')
    || /connection terminated|connection timeout|timeout exceeded when trying to connect/i.test(error?.message || '');
}
