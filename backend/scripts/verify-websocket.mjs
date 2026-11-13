import { pathToFileURL } from "node:url";
import WebSocket from "ws";

const MAX_SHUTDOWN_TIMEOUT_MS = 1000;

export function validateWebSocketUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("WebSocket URL must be a valid ws:// or wss:// URL");
  }

  if (
    !["ws:", "wss:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("WebSocket URL must use ws:// or wss:// without credentials, query, or fragment");
  }

  return url;
}

export function websocketHeaders(token) {
  if (!token) throw new Error("WS_TEST_TOKEN is required");
  return { Authorization: `Bearer ${token}` };
}

export async function verifyWebSocket(url, token, timeoutMs = 10000) {
  validateWebSocketUrl(url);

  return new Promise((resolve, reject) => {
    let socket;
    let settled = false;
    let timer;
    let shutdownTimer;
    let opened = false;

    const cleanupHandshake = () => {
      clearTimeout(timer);
      socket?.removeListener("open", onOpen);
      socket?.removeListener("unexpected-response", onUnexpectedResponse);
    };

    const onErrorSink = () => {};
    const onClose = () => {
      clearTimeout(shutdownTimer);
      if (opened && !settled) {
        settled = true;
        cleanupHandshake();
        socket.removeListener("error", onError);
        socket.removeListener("error", onErrorSink);
        socket.removeListener("close", onClose);
        resolve({ ok: true, url });
        return;
      }
      socket.removeListener("error", onErrorSink);
      socket.removeListener("close", onClose);
    };

    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      cleanupHandshake();
      clearTimeout(shutdownTimer);
      socket?.on("error", onErrorSink);
      socket?.once("close", onClose);
      socket?.removeListener("error", onError);
      reject(error);
    };

    const onOpen = () => {
      opened = true;
      cleanupHandshake();
      socket.once("close", onClose);
      socket.close(1000, "verified");
      shutdownTimer = setTimeout(() => socket.terminate(), Math.min(MAX_SHUTDOWN_TIMEOUT_MS, Math.max(1, timeoutMs)));
    };

    const onUnexpectedResponse = (_request, response) => {
      response.resume();
      rejectOnce(new Error(`WebSocket handshake returned HTTP ${response.statusCode}`));
      socket.terminate();
    };

    const onError = () => {
      rejectOnce(new Error("WebSocket connection failed"));
    };

    try {
      socket = new WebSocket(url, { headers: websocketHeaders(token) });
      socket.once("open", onOpen);
      socket.once("unexpected-response", onUnexpectedResponse);
      socket.once("error", onError);
      timer = setTimeout(() => {
        rejectOnce(new Error("WebSocket handshake timed out"));
        socket.terminate();
      }, timeoutMs);
    } catch {
      rejectOnce(new Error("WebSocket connection failed"));
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.argv[2];
  if (!url) throw new Error("Usage: npm run verify:websocket -- <wss-url>");
  const result = await verifyWebSocket(url, process.env.WS_TEST_TOKEN || "");
  console.log(JSON.stringify(result));
}
