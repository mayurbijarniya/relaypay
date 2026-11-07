import "server-only";
import type { DB } from "@/lib/store";

/**
 * Database-backed rate limits for the public demo. Stored in the same document
 * as everything else, so they survive restarts and apply across instances.
 * Call inside mutate() so the check and the increment are atomic.
 *
 * Set DISABLE_RATE_LIMITS=true for local development.
 */

export type Limit = { windowMs: number; perWindow: number; perDay: number };

export const LIMITS: Record<string, Limit> = {
  // Each agent run spends LLM credits.
  agent: { windowMs: 10 * 60_000, perWindow: 8, perDay: 120 },
  // The walkthrough's one-click agent run.
  walkthrough: { windowMs: 5 * 60_000, perWindow: 1, perDay: 50 },
  // Each capture moves sandbox money from the demo buyer.
  capture: { windowMs: 10 * 60_000, perWindow: 6, perDay: 80 },
  // Disputes and PayPal reads triggered from the UI.
  paypal: { windowMs: 5 * 60_000, perWindow: 20, perDay: 400 },
};

export function clientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "local";
  return forwarded.split(",")[0].trim().slice(0, 64) || "local";
}

export function checkRateLimit(db: DB, scope: keyof typeof LIMITS, ip: string): { ok: true } | { ok: false; reason: string } {
  if (process.env.DISABLE_RATE_LIMITS === "true") return { ok: true };
  const limit = LIMITS[scope];
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  // Drop rows older than two days so the table stays small.
  const cutoff = now - 2 * 86_400_000;
  db.rateLimits = db.rateLimits.filter((r) => Number(r.lastAt || 0) >= cutoff);

  const key = `${scope}:${ip}:${today}`;
  let row = db.rateLimits.find((r) => r.key === key);
  const globalToday = db.rateLimits
    .filter((r) => r.day === today && r.key.startsWith(`${scope}:`))
    .reduce((sum, r) => sum + Number(r.count || 0), 0);

  if (globalToday >= limit.perDay) {
    return { ok: false, reason: `The demo reached today's limit for this action (${limit.perDay}). Try again tomorrow.` };
  }

  const windowStart = row?.windowStart && now - row.windowStart < limit.windowMs ? row.windowStart : now;
  const windowCount = windowStart === row?.windowStart ? Number(row?.windowCount || 0) : 0;
  if (windowCount >= limit.perWindow) {
    const minutes = Math.ceil((limit.windowMs - (now - windowStart)) / 60_000);
    return { ok: false, reason: `Too many requests. Please wait about ${minutes} minute${minutes === 1 ? "" : "s"}.` };
  }

  if (!row) {
    row = { key, count: 0, day: today, lastAt: now };
    db.rateLimits.push(row);
  }
  row.count = Number(row.count || 0) + 1;
  row.lastAt = now;
  row.windowStart = windowStart;
  row.windowCount = windowCount + 1;
  return { ok: true };
}
