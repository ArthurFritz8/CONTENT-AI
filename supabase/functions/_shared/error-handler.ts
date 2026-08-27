import { DEFAULT_RETRY_OPTIONS } from "./constants.ts";

export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AppError";
  }
}

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (err: unknown) => boolean;
  onRetry?: (attempt: number, err: unknown) => void;
}

/** Retry com exponential backoff + jitter para chamadas externas (Regra D). */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const {
    retries = DEFAULT_RETRY_OPTIONS.retries,
    baseDelayMs = DEFAULT_RETRY_OPTIONS.baseDelayMs,
    maxDelayMs = DEFAULT_RETRY_OPTIONS.maxDelayMs,
    shouldRetry = () => true,
    onRetry,
  } = opts;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !shouldRetry(err)) break;
      onRetry?.(attempt + 1, err);
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt) *
        (0.5 + Math.random() * 0.5);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/** Erros HTTP 5xx/429 são transitórios; 4xx não deve ser reprocessado. */
export function isTransientHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function toErrorResponse(err: unknown): Response {
  const isApp = err instanceof AppError;
  const status = isApp ? err.status : 500;
  const body = {
    error: isApp ? err.message : "Erro interno",
    code: isApp ? err.code : "INTERNAL_ERROR",
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
