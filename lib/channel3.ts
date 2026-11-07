import "server-only";
import type { MarketCheck } from "@/lib/receipts";

/**
 * Channel3 (hackathon sponsor) — live product catalog search.
 *
 * RelayPay buys only from the cafe's contracted catalog, so Channel3 is used
 * as a market price check: the purchasing agent compares the supplier price
 * with real retail offers before proposing. The result is sealed into the
 * receipt, so the owner (and later a dispute reviewer) can see the agent
 * checked the market.
 *
 * Contract: POST https://api.trychannel3.com/v1/search, header x-api-key.
 * Prices live on product.offers[].price.price. Enabled only when
 * CHANNEL3_API_KEY is set; every failure degrades to "NO_DATA".
 */

const ENDPOINT = process.env.CHANNEL3_BASE_URL || "https://api.trychannel3.com/v1/search";
const TIMEOUT_MS = 8000;

export function channel3Enabled() {
  return !!process.env.CHANNEL3_API_KEY;
}

export type MarketOffer = { title: string; merchant: string; price: number; currency: string; url: string };

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function searchMarket(query: string, limit = 12): Promise<{ ok: boolean; offers: MarketOffer[]; error?: string }> {
  if (!channel3Enabled()) return { ok: false, offers: [], error: "Channel3 is not configured" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "x-api-key": String(process.env.CHANNEL3_API_KEY), "Content-Type": "application/json" },
      body: JSON.stringify({
        query: String(query).slice(0, 200),
        limit: Math.max(1, Math.min(30, limit)),
        filters: { availability: ["InStock"] },
        config: { mode: "default", currency: "USD", country: "US" },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const reason =
        res.status === 401 ? "invalid Channel3 API key" : res.status === 402 ? "Channel3 credits exhausted" : `Channel3 returned ${res.status}`;
      return { ok: false, offers: [], error: reason };
    }
    const data: any = await res.json();
    const offers: MarketOffer[] = [];
    for (const product of Array.isArray(data?.products) ? data.products : []) {
      const offer = (Array.isArray(product?.offers) ? product.offers : []).find(
        (o: any) => Number.isFinite(Number(o?.price?.price)) && (o?.price?.currency || "USD") === "USD"
      );
      if (!offer) continue;
      offers.push({
        title: String(product.title || "Product").slice(0, 120),
        merchant: String(offer.domain || "").slice(0, 60),
        price: Number(offer.price.price),
        currency: "USD",
        url: String(offer.url || ""),
      });
    }
    return { ok: true, offers };
  } catch (e: any) {
    return { ok: false, offers: [], error: e?.name === "AbortError" ? "Channel3 timed out" : "Channel3 request failed" };
  } finally {
    clearTimeout(timer);
  }
}

/** Compare a catalog unit price against live market offers. */
export async function marketCheck(product: string, catalogUnitPrice: string): Promise<{ check: MarketCheck; offers: MarketOffer[]; error?: string }> {
  const query = product.replace(/\(.*?\)/g, "").trim();
  const { ok, offers, error } = await searchMarket(query);
  const prices = offers.map((o) => o.price).filter((p) => p > 0);
  const med = median(prices);
  const low = prices.length ? Math.min(...prices) : null;
  const catalog = Number(catalogUnitPrice);
  let verdict: MarketCheck["verdict"] = "NO_DATA";
  if (ok && med != null) {
    if (catalog < med * 0.95) verdict = "BELOW_MARKET";
    else if (catalog > med * 1.1) verdict = "ABOVE_MARKET";
    else verdict = "AT_MARKET";
  }
  return {
    check: {
      source: "channel3",
      query,
      offerCount: prices.length,
      medianPrice: med != null ? med.toFixed(2) : null,
      lowestPrice: low != null ? low.toFixed(2) : null,
      catalogPrice: catalog.toFixed(2),
      verdict,
      checkedAt: new Date().toISOString(),
    },
    offers: offers.slice(0, 5),
    error,
  };
}
