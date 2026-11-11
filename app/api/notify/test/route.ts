import { NextResponse } from "next/server";
import { addLedger, mutate, HttpError } from "@/lib/store";
import { alertsChannel, alertsEnabled, notifyOwner } from "@/lib/notify";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { route } from "@/lib/http";

/** Send a test alert to the owner's alert channel. */
export const POST = route(async (req: Request) => {
  if (!alertsEnabled()) throw new HttpError(400, "Set ALERT_WEBHOOK_URL to a Discord, Slack or ntfy.sh URL first.");
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
  if (!result.sent) throw new HttpError(502, result.error || "The alert channel did not accept the message.");
  await mutate((db) => addLedger(db, { actor: "SYSTEM", eventType: "OWNER_NOTIFIED", note: `Test alert sent through ${alertsChannel()}` }));
  return NextResponse.json({ sent: true });
});
