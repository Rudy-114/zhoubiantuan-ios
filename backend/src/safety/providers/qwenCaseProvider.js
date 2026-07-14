import { config } from "../../config.js";
import { validateQwenCaseResult } from "../schemas/qwenCaseResult.js";

const FIXED_MODEL = "qwen3.7-plus-2026-05-26";
const MAX_COMPLETION_TOKENS = 900;

export class QwenCaseProvider {
  constructor({
    baseUrl = config.safetyAi.baseUrl,
    apiKey = config.safetyAi.apiKey,
    timeoutMs = config.safetyAi.timeoutMs,
    fetchImpl = globalThis.fetch
  } = {}) {
    this.baseUrl = String(baseUrl || "").replace(/\/+$/u, "");
    this.apiKey = typeof apiKey === "string" ? apiKey : "";
    this.timeoutMs = positiveTimeout(timeoutMs);
    this.fetchImpl = fetchImpl;
  }

  async analyze({ messages } = {}) {
    if (!this.apiKey || typeof this.fetchImpl !== "function") {
      throw providerError("qwen_not_configured", { retryable: false, billingUncertain: false });
    }
    if (!validMessages(messages)) {
      throw providerError("qwen_request_invalid", { retryable: false, billingUncertain: false });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: FIXED_MODEL,
          messages,
          response_format: { type: "json_object" },
          enable_thinking: false,
          temperature: 0.1,
          max_completion_tokens: MAX_COMPLETION_TOKENS,
          stream: false
        }),
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") {
        throw providerError("qwen_timeout", { retryable: true, billingUncertain: true });
      }
      throw providerError("qwen_provider_error", { retryable: true, billingUncertain: true });
    } finally {
      clearTimeout(timeout);
    }

    if (!response || typeof response.ok !== "boolean") {
      throw providerError("qwen_invalid_response", { retryable: false, billingUncertain: false });
    }
    if (!response.ok) {
      if (response.status === 429) {
        throw providerError("qwen_rate_limited", {
          retryable: true,
          billingUncertain: false,
          status: 429
        });
      }
      throw providerError("qwen_provider_error", {
        retryable: response.status >= 500,
        billingUncertain: false,
        status: safeStatus(response.status)
      });
    }

    const payload = await parseResponse(response);
    const rawContent = payload?.choices?.[0]?.message?.content;
    if (typeof rawContent !== "string" || !rawContent) {
      throw providerError("qwen_invalid_response", { retryable: false, billingUncertain: false });
    }

    let candidate;
    try {
      candidate = JSON.parse(rawContent);
    } catch {
      throw providerError("qwen_invalid_response", { retryable: false, billingUncertain: false });
    }

    let result;
    try {
      result = validateQwenCaseResult(candidate);
    } catch (error) {
      if (error?.code === "invalid_ai_result") {
        error.retryable = false;
        error.billingUncertain = false;
        throw error;
      }
      throw providerError("qwen_invalid_response", { retryable: false, billingUncertain: false });
    }

    return {
      result,
      usage: normalizeUsage(payload.usage),
      requestId: requestId(response, payload),
      rawContent
    };
  }
}

export function providerError(code, {
  retryable = false,
  billingUncertain = false,
  status
} = {}) {
  const error = new Error("Qwen provider request failed");
  error.code = code;
  error.retryable = retryable;
  error.billingUncertain = billingUncertain;
  if (status !== undefined) error.status = status;
  return error;
}

async function parseResponse(response) {
  try {
    return await response.json();
  } catch {
    throw providerError("qwen_invalid_response", { retryable: false, billingUncertain: false });
  }
}

function normalizeUsage(value) {
  const inputTokens = safeTokenCount(value?.prompt_tokens);
  const outputTokens = safeTokenCount(value?.completion_tokens);
  const totalTokens = value?.total_tokens == null
    ? inputTokens + outputTokens
    : safeTokenCount(value.total_tokens);
  return { inputTokens, outputTokens, totalTokens };
}

function safeTokenCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw providerError("qwen_invalid_response", { retryable: false, billingUncertain: false });
  }
  return value;
}

function requestId(response, payload) {
  const headerValue = response.headers?.get?.("x-request-id") || response.headers?.get?.("request-id");
  const value = headerValue || payload?.request_id || payload?.id || "";
  if (typeof value !== "string") return "";
  return Array.from(value.trim()).slice(0, 160).join("");
}

function safeStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : 502;
}

function positiveTimeout(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 12_000;
}

function validMessages(value) {
  return Array.isArray(value) && value.length > 0 && value.every((message) =>
    message && typeof message === "object" && !Array.isArray(message) &&
    ["system", "user", "assistant"].includes(message.role) &&
    typeof message.content === "string"
  );
}
