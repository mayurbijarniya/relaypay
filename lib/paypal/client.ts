import "server-only";
import { env, requirePayPalEnv } from "@/lib/env";

const SANDBOX = "https://api-m.sandbox.paypal.com";
const LIVE = "https://api-m.paypal.com";

export const paypalBaseUrl = env.paypalEnvironment === "live" ? LIVE : SANDBOX;

export class PayPalApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PayPalApiError";
    this.status = status;
  }
}

let cachedToken: { token: string; expiresAt: number } | null = null;

const DEFAULT_TIMEOUT_MS = 20_000;

/** PAYPAL_TIMEOUT_MS overrides every PayPal timeout (the tests use a tiny one). */
function timeoutMs(fallback = DEFAULT_TIMEOUT_MS) {
  const n = Number(process.env.PAYPAL_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * fetch with a hard timeout, so a hung PayPal call fails fast with a readable
 * error instead of hanging the request. Pass a longer limit for file uploads.
 */
export async function paypalRequest(url: string, init: RequestInit = {}, opts: { timeoutMs?: number } = {}): Promise<Response> {
  const ms = timeoutMs(opts.timeoutMs);
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new PayPalApiError(504, `PayPal ${new URL(url).pathname} timed out after ${ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`}`);
    }
    throw e;
  }
}

export async function getAccessToken(): Promise<string> {
  requirePayPalEnv();
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const credentials = Buffer.from(
    `${env.paypalClientId}:${env.paypalClientSecret}`
  ).toString("base64");

  const res = await paypalRequest(`${paypalBaseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    throw new Error(`PayPal OAuth failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.token;
}

export async function paypalFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getAccessToken();
  const reqId = (options.headers as any)?.["PayPal-Request-Id"] || crypto.randomUUID();
  const res = await paypalRequest(`${paypalBaseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": reqId,
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    throw new PayPalApiError(res.status, `PayPal ${path} failed: ${res.status} ${await res.text()}`);
  }

  // Some PayPal actions (accept-claim, require-evidence, delete) return 204
  // with no body. Parsing those as JSON would throw and look like a failure.
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}
