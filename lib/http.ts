import "server-only";
import { NextResponse } from "next/server";
import { HttpError } from "@/lib/store";
import { PayPalApiError } from "@/lib/paypal/client";

/**
 * Wrap a route handler so every failure becomes a readable JSON error.
 * HttpError keeps its status; PayPal 404 stays 404; anything else from PayPal
 * is a 502 (bad gateway); unexpected errors are 500.
 */
export function route<A extends any[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e: any) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message, ...(e.body || {}) }, { status: e.status });
      if (e instanceof PayPalApiError) {
        return NextResponse.json({ error: readablePayPalError(e.message) }, { status: e.status === 404 ? 404 : 502 });
      }
      console.error("[relaypay]", e);
      return NextResponse.json({ error: e?.message || "Unexpected server error" }, { status: 500 });
    }
  };
}

/** PayPal error bodies are JSON blobs; keep the parts a person can act on. */
export function readablePayPalError(message: string) {
  const text = String(message || "PayPal request failed");
  const issue = text.match(/"issue"\s*:\s*"([^"]+)"/)?.[1];
  const description = text.match(/"description"\s*:\s*"([^"]+)"/)?.[1];
  const msg = text.match(/"message"\s*:\s*"([^"]+)"/)?.[1];
  const head = text.split(/[{[]/)[0].trim();
  const parts = [head, issue, description || msg].filter(Boolean);
  return parts.length ? parts.join(" · ").slice(0, 400) : text.slice(0, 400);
}

export async function readJson(req: Request): Promise<Record<string, any>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}
