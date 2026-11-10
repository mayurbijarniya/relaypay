/**
 * RelayPay spend policy and cafe catalog.
 *
 * Pure module (no server-only imports) so it can be unit tested with node:test.
 * The backend recomputes every price from this catalog, enforces a daily cap,
 * and flags high-value purchases. The policy version and the checks that ran
 * are sealed into the receipt hash.
 */

export const POLICY_VERSION = "policy-v3";
export const CATALOG_CURRENCY = "USD";

function positiveIntFromEnv(name: string, fallback: number): number {
  const n = Math.floor(Number(process.env[name]));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Today's spend limit across the whole café. 500 by default; a hosted demo that
 * many judges share can raise it with DAILY_CAP_USD. The cap in force when a
 * receipt is approved is sealed into that receipt's policy checks.
 */
export const DAILY_CAP_USD = positiveIntFromEnv("DAILY_CAP_USD", 500);
export const HIGH_VALUE_USD = 100;
export const MAX_SINGLE_PURCHASE_USD = 10_000;
export const MAX_QUANTITY = 20;

export type CatalogItem = {
  /** Supplier unit price in cents, so money never touches floating point. */
  priceCents: number;
  /** Units the cafe uses on a normal day. */
  dailyUsage: number;
  /** Reorder when on-hand stock is at or below this. */
  reorderPoint: number;
  /** Target stock after a reorder. */
  parLevel: number;
  /** On-hand stock for a fresh demo. */
  startOnHand: number;
  unit: string;
};

export const CATALOG: Record<string, CatalogItem> = {
  "Coffee beans 40lb bag": { priceCents: 4200, dailyUsage: 1, reorderPoint: 2, parLevel: 3, startOnHand: 1, unit: "bag" },
  "Coffee beans 5lb bag": { priceCents: 1850, dailyUsage: 1, reorderPoint: 2, parLevel: 6, startOnHand: 5, unit: "bag" },
  "Oat milk case (12)": { priceCents: 2400, dailyUsage: 2, reorderPoint: 4, parLevel: 10, startOnHand: 6, unit: "case" },
  "Sugar 10lb bag": { priceCents: 1200, dailyUsage: 1, reorderPoint: 2, parLevel: 5, startOnHand: 4, unit: "bag" },
};

export function initialInventory(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, item] of Object.entries(CATALOG)) out[name] = item.startOnHand;
  return out;
}

export type PolicyChecks = {
  policyVersion: string;
  catalogPrice: string;
  quantity: number;
  computedAmount: string;
  dailyCap: string;
  spentToday: string;
  remainingToday: string;
  withinDailyCap: boolean;
  highValue: boolean;
  requiresOwnerConfirmation: boolean;
  catalogMatched: boolean;
  withinQuantityLimit: boolean;
};

export function centsFromUsd(value: number | string): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

export function usd(valueCents: number): string {
  return (valueCents / 100).toFixed(2);
}

export function evaluatePolicy(input: { unitPriceCents: number; quantity: number; spentTodayCents: number }): PolicyChecks {
  const computedCents = input.unitPriceCents * input.quantity;
  const capCents = DAILY_CAP_USD * 100;
  const remainingCents = Math.max(0, capCents - input.spentTodayCents);
  const highValue = computedCents > HIGH_VALUE_USD * 100;
  return {
    policyVersion: POLICY_VERSION,
    catalogPrice: usd(input.unitPriceCents),
    quantity: input.quantity,
    computedAmount: usd(computedCents),
    dailyCap: usd(capCents),
    spentToday: usd(input.spentTodayCents),
    remainingToday: usd(remainingCents),
    withinDailyCap: computedCents <= remainingCents,
    highValue,
    requiresOwnerConfirmation: highValue,
    catalogMatched: true,
    withinQuantityLimit: input.quantity >= 1 && input.quantity <= MAX_QUANTITY,
  };
}

/**
 * Tokenize product names so "40lb" and "40 lb" are the same token sequence.
 * Splitting letters and digits separately prevents the 40lb and 5lb bags from
 * tying on "coffee beans bag".
 */
function productTokens(value: string): string[] {
  return String(value || "").toLowerCase().match(/[a-z]+|\d+/g) || [];
}

function compact(value: string): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Match the model's product string to a real catalog key. No invented products. */
export function matchProduct(name: string): string | null {
  if (!name) return null;
  const needle = compact(name);
  if (!needle) return null;

  const keys = Object.keys(CATALOG);
  const exact = keys.find((key) => compact(key) === needle);
  if (exact) return exact;

  const needleTokens = new Set(productTokens(name));
  const scored = keys
    .map((key) => ({ key, score: productTokens(key).reduce((sum, t) => sum + (needleTokens.has(t) ? 1 : 0), 0) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score === 0) return null;
  // A tie means the string is ambiguous ("coffee beans bag"). Returning null is
  // safer than silently buying the wrong pack size at the wrong price.
  const tied = scored.filter((c) => c.score === best.score);
  return tied.length === 1 ? best.key : null;
}

export type StockRow = {
  product: string;
  unitPrice: string;
  onHand: number;
  reorderPoint: number;
  parLevel: number;
  dailyUsage: number;
  daysLeft: number;
  low: boolean;
  suggestedQuantity: number;
};

export function stockRow(product: string, inventory: Record<string, number>): StockRow {
  const item = CATALOG[product];
  const onHand = Math.max(0, Math.floor(Number(inventory?.[product] ?? item.startOnHand)));
  const low = onHand <= item.reorderPoint;
  return {
    product,
    unitPrice: usd(item.priceCents),
    onHand,
    reorderPoint: item.reorderPoint,
    parLevel: item.parLevel,
    dailyUsage: item.dailyUsage,
    daysLeft: item.dailyUsage > 0 ? Math.floor(onHand / item.dailyUsage) : 99,
    low,
    suggestedQuantity: low ? Math.min(MAX_QUANTITY, Math.max(1, item.parLevel - onHand)) : 0,
  };
}

/** Shared token scoring for the agent's search_catalog tool. */
export function searchCatalog(query: string, inventory: Record<string, number> = initialInventory()) {
  const needleTokens = new Set(productTokens(query));
  return Object.keys(CATALOG)
    .map((product) => ({ product, score: productTokens(product).reduce((s, t) => s + (needleTokens.has(t) ? 1 : 0), 0) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.product.localeCompare(b.product))
    .slice(0, 5)
    .map(({ product }) => {
      const row = stockRow(product, inventory);
      return { product, unitPrice: row.unitPrice, onHand: row.onHand, low: row.low };
    });
}

export function lowStock(inventory: Record<string, number>): StockRow[] {
  return Object.keys(CATALOG)
    .map((p) => stockRow(p, inventory))
    .filter((r) => r.low)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/**
 * Today's captured spend. `capturedAt` is when the money actually moved;
 * `createdAt` is only a fallback for older records.
 */
export function spentTodayCents(orders: Array<{ status: string; amount: string; createdAt: string; capturedAt?: string }>): number {
  const today = new Date().toISOString().slice(0, 10);
  return orders
    .filter((o) => o.status === "COMPLETED")
    .filter((o) => String(o.capturedAt || o.createdAt || "").slice(0, 10) === today)
    .reduce((sum, o) => {
      const cents = centsFromUsd(o.amount);
      return sum + (Number.isFinite(cents) ? cents : 0);
    }, 0);
}
