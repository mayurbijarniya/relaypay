import { NextResponse } from "next/server";
import { addLedger, loadDB, mutate, HttpError } from "@/lib/store";
import { createSandboxDispute, getDispute } from "@/lib/paypal/disputes";
import { draftAndSave } from "@/lib/disputeService";
import { env, isSandbox } from "@/lib/env";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { readablePayPalError, readJson, route } from "@/lib/http";

const REASONS = new Set(["UNAUTHORISED", "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED"]);

const MANUAL_STEPS = [
  "Log in to https://www.sandbox.paypal.com as the sandbox buyer (Personal) account.",
  "Open Activity, select the RelayPay payment, and choose “Report a problem”.",
  "File the dispute, then come back and press “Check PayPal for new disputes”.",
];

/**
 * Sandbox only: open a real PayPal sandbox dispute against a RelayPay payment,
 * acting as the sandbox buyer (PayPal-Auth-Assertion). Requires the buyer-side
 * transaction ID and the DISPUTE_CREATE scope on the REST app; when PayPal
 * refuses, the response explains the Resolution Center route instead.
 */
export const POST = route(async (req: Request) => {
  if (!isSandbox()) throw new HttpError(403, "Disputes can only be opened from RelayPay in the PayPal sandbox.");
  const body = await readJson(req);
  const orderId = String(body.orderId || "");
  const buyerTransactionId = String(body.buyerTransactionId || "").trim().toUpperCase();
  const reason = REASONS.has(String(body.reason)) ? String(body.reason) : "UNAUTHORISED";
  const ip = clientIp(req);

  if (!env.sandboxBuyerEmail) {
    throw new HttpError(400, "Set SANDBOX_BUYER_EMAIL (the sandbox buyer's email) to open disputes from RelayPay.", { manualSteps: MANUAL_STEPS });
  }
  if (!/^[A-Z0-9]{8,30}$/.test(buyerTransactionId)) {
    throw new HttpError(400, "Paste the buyer's transaction ID from the sandbox buyer's Activity page (letters and digits).", {
      manualSteps: MANUAL_STEPS,
    });
  }

  await mutate((db) => {
    const limit = checkRateLimit(db, "paypal", ip);
    if (!limit.ok) throw new HttpError(429, limit.reason);
  });
  const snapshot = await loadDB();
  const order = snapshot.orders.find((o) => o.id === orderId);
  if (!order || order.status !== "COMPLETED" || !order.captureId) throw new HttpError(400, "Pick a captured RelayPay payment.");

  const created = await createSandboxDispute({
    clientId: env.paypalClientId,
    buyerEmail: env.sandboxBuyerEmail,
    buyerTransactionId,
    amount: order.amount,
    currency: order.currency || "USD",
    reason,
  });

  if (!created.ok) {
    const scopeProblem = created.status === 401 || created.status === 403;
    throw new HttpError(
      scopeProblem ? 403 : 502,
      scopeProblem
        ? "PayPal refused to create the dispute. Sandbox dispute creation needs the DISPUTE_CREATE scope on your REST app, which PayPal enables on request. Open it from the buyer's account instead."
        : `PayPal could not create the dispute: ${readablePayPalError(JSON.stringify(created.body))}`,
      { manualSteps: MANUAL_STEPS }
    );
  }

  const links: any[] = Array.isArray(created.body?.links) ? created.body.links : [];
  const disputeId =
    created.body?.dispute_id ||
    links.map((l) => String(l?.href || "").match(/disputes\/(PP-[A-Z]-[A-Z0-9-]+)/i)?.[1]).find(Boolean) ||
    null;

  await mutate((db) => {
    addLedger(db, {
      actor: "SYSTEM",
      eventType: "SANDBOX_DISPUTE_OPENED",
      intentId: order.intentId,
      orderId: order.id,
      note: `Sandbox ${reason} dispute opened${disputeId ? ` (${disputeId})` : ""} as the test buyer`,
    });
  });

  if (disputeId) {
    // PayPal can take a moment before the new dispute is readable.
    const full = await getDispute(disputeId).catch(() => null);
    if (full) {
      const dispute = await draftAndSave({ paypalDisputeId: full.dispute_id || disputeId, paypalDispute: full, source: "SANDBOX_CREATE" });
      return NextResponse.json({ opened: true, disputeId, dispute });
    }
  }
  return NextResponse.json({
    opened: true,
    disputeId,
    note: "PayPal accepted the dispute. It can take a minute to appear; press “Check PayPal for new disputes”.",
  });
});
