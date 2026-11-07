import { NextResponse } from "next/server";
import { addLedger, mutate, HttpError } from "@/lib/store";
import { notifyOwner, zapierEnabled } from "@/lib/notify";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { route } from "@/lib/http";

/** Send a test notification through the owner's Zapier hook. */
export const POST = route(async (req: Request) => {
  if (!zapierEnabled()) throw new HttpError(400, "Set ZAPIER_WEBHOOK_URL to a Zapier Catch Hook URL (https://hooks.zapier.com/…) first.");
  const ip = clientIp(req);
  await mutate((db) => {
    const limit = checkRateLimit(db, "paypal", ip);
    if (!limit.ok) throw new HttpError(429, limit.reason);
  });
  const result = await notifyOwner("test", {
    title: "RelayPay test notification",
    message: "If you can read this, RelayPay can reach you when a purchase or dispute needs you.",
    view: "settings",
  });
  if (!result.sent) throw new HttpError(502, result.error || "Zapier did not accept the notification.");
  await mutate((db) => addLedger(db, { actor: "SYSTEM", eventType: "OWNER_NOTIFIED", note: "Test notification sent through Zapier" }));
  return NextResponse.json({ sent: true });
});
