import { NextResponse } from "next/server";
import { addLedger, mutate, HttpError } from "@/lib/store";
import { CATALOG, lowStock } from "@/lib/policy";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { route } from "@/lib/http";

/**
 * Simulate one cafe day: every product drops by its daily usage. This is what
 * makes the purchasing agent autonomous: stock falls, it notices, it reorders.
 */
export const POST = route(async (req: Request) => {
  const ip = clientIp(req);
  const result = await mutate((db) => {
    const limit = checkRateLimit(db, "paypal", ip);
    if (!limit.ok) throw new HttpError(429, limit.reason);
    const used: string[] = [];
    for (const [product, item] of Object.entries(CATALOG)) {
      const before = db.inventory[product] ?? item.startOnHand;
      const after = Math.max(0, before - item.dailyUsage);
      db.inventory[product] = after;
      if (before !== after) used.push(`${item.dailyUsage} × ${product}`);
    }
    const low = lowStock(db.inventory);
    addLedger(db, {
      actor: "SYSTEM",
      eventType: "STOCK_CONSUMED",
      note: `${used.join(", ") || "Nothing"} used${low.length ? ` · low: ${low.map((r) => r.product).join(", ")}` : ""}`,
    });
    return { inventory: db.inventory, low: low.map((r) => r.product) };
  });
  return NextResponse.json(result);
});
