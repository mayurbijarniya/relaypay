import { NextResponse } from "next/server";
import { addLedger, loadDB, mutate, HttpError } from "@/lib/store";
import { getOrder } from "@/lib/paypal/orders";
import { hashReceipt } from "@/lib/receipts";
import { centsFromUsd } from "@/lib/policy";
import { route } from "@/lib/http";

/**
 * Prove a receipt with PayPal's own record: re-read the order from PayPal,
 * recompute the SHA-256 of the sealed receipt, and check that PayPal's
 * custom_id, the amount and the capture all agree.
 */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const snapshot = await loadDB();
  const order = snapshot.orders.find((o) => o.id === id || o.paypalOrderId === id);
  if (!order) throw new HttpError(404, "Payment not found");
  const intent = snapshot.intents.find((i) => i.id === order.intentId);
  if (!intent?.receiptPayload) throw new HttpError(400, "This payment has no sealed receipt.");

  const paypalOrder: any = await getOrder(order.paypalOrderId);
  const unit = paypalOrder.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  const paypalCustomId = unit?.custom_id || capture?.custom_id || null;
  const recomputed = hashReceipt(intent.receiptPayload);

  const checks = {
    receiptMatches: recomputed === intent.receiptHash,
    customIdMatches: !!paypalCustomId && recomputed === paypalCustomId,
    amountMatches:
      !!unit?.amount?.value &&
      centsFromUsd(unit.amount.value) === centsFromUsd(intent.amount) &&
      (unit.amount.currency_code || "USD") === (intent.currency || "USD"),
    captureMatches: !order.captureId || !capture?.id || order.captureId === capture.id,
    paypalCaptured: paypalOrder.status === "COMPLETED" && capture?.status === "COMPLETED",
  };
  const verified = Object.values(checks).every(Boolean);

  const updated = await mutate((db) => {
    const o = db.orders.find((x) => x.id === order.id);
    if (!o) throw new HttpError(404, "Payment not found");
    // Repair a missing capture ID from PayPal's record after a clean check.
    if (verified && capture?.id && !o.captureId) o.captureId = capture.id;
    o.verifiedAt = new Date().toISOString();
    o.verificationSource = verified ? "PAYPAL_CUSTOM_ID" : "MISMATCH";
    addLedger(db, {
      actor: "SYSTEM",
      eventType: verified ? "RECEIPT_VERIFIED" : "RECEIPT_VERIFY_FAILED",
      intentId: o.intentId,
      orderId: o.id,
      note: verified
        ? `Recomputed hash equals PayPal custom_id ${String(paypalCustomId).slice(0, 12)}…`
        : `Failed: ${Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k).join(", ")}`,
    });
    return o;
  });

  return NextResponse.json({
    verified,
    ...checks,
    paypalOrderId: order.paypalOrderId,
    captureId: updated.captureId,
    storedHash: order.customId,
    recomputedHash: recomputed,
    paypalCustomId,
    status: paypalOrder.status,
    verifiedAt: updated.verifiedAt,
    message: verified
      ? "Verified: the recomputed receipt hash equals PayPal's custom_id, and PayPal captured the approved amount."
      : "Mismatch: the receipt, PayPal's custom_id, the amount or the capture did not agree.",
  });
});
