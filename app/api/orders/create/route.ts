import { NextResponse } from "next/server";
import { addLedger, mutate, uid, HttpError, type OrderRecord } from "@/lib/store";
import { createCaptureOrderWithVault, captureOrder, getOrder } from "@/lib/paypal/orders";
import { hashReceipt } from "@/lib/receipts";
import { CATALOG, CATALOG_CURRENCY, DAILY_CAP_USD, centsFromUsd, matchProduct, spentTodayCents, usd } from "@/lib/policy";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { notifyOwner } from "@/lib/notify";
import { readJson, route } from "@/lib/http";

/** Capture only when PayPal did not already complete the order. */
async function ensureCaptured(order: any): Promise<any> {
  if (order.status === "COMPLETED") return order;
  const canCapture = order.links?.some((l: any) => l.rel === "capture");
  if (!canCapture && order.status !== "APPROVED") return order;
  try {
    return await captureOrder(order.id);
  } catch (error) {
    // A retry can race a capture that already succeeded. Re-read the order
    // rather than reporting a failure for a completed payment.
    const fresh = await getOrder(order.id).catch(() => null);
    if (fresh?.status === "COMPLETED") return fresh;
    throw error;
  }
}

/**
 * Pay for an approved proposal: create a PayPal order with the vaulted payment
 * method and custom_id = receipt hash, then make sure it is captured.
 *
 * PayPal-Request-Id makes order creation and capture idempotent, so a double
 * click or a retry returns the same PayPal order instead of charging twice.
 */
export const POST = route(async (req: Request) => {
  const { intentId } = await readJson(req);
  const ip = clientIp(req);

  // 1. Validate inside the lock.
  const plan = await mutate((db) => {
    const intent = db.intents.find((i) => i.id === intentId);
    if (!intent) throw new HttpError(404, "Proposal not found");

    const completed = db.orders.find((o) => o.intentId === intent.id && o.status === "COMPLETED");
    if (completed) {
      if (intent.status !== "CAPTURED") intent.status = "CAPTURED";
      return { done: completed };
    }
    if (intent.status !== "APPROVED") throw new HttpError(409, "Approve the receipt before paying.");
    if (!intent.receiptPayload || !intent.receiptHash) throw new HttpError(409, "The receipt is not sealed yet.");
    if (hashReceipt(intent.receiptPayload) !== intent.receiptHash) {
      throw new HttpError(409, "The receipt changed after approval; refusing to pay. Ask the agent again.");
    }

    const product = matchProduct(intent.product);
    const quantity = Math.floor(Number(intent.quantity));
    if (!product || !Number.isInteger(quantity) || quantity < 1) throw new HttpError(409, "This proposal no longer matches the catalog.");
    const expectedCents = CATALOG[product].priceCents * quantity;
    if (centsFromUsd(intent.amount) !== expectedCents) {
      throw new HttpError(409, `Receipt amount $${intent.amount} doesn't match the catalog ($${usd(expectedCents)}).`);
    }
    if ((intent.currency || CATALOG_CURRENCY) !== CATALOG_CURRENCY) throw new HttpError(409, "Unsupported currency.");

    // Enforce the cap again at payment time; two approvals could otherwise
    // both pass and together exceed the limit.
    const spent = spentTodayCents(db.orders);
    if (spent + expectedCents > DAILY_CAP_USD * 100) {
      throw new HttpError(409, `Over today's cap: $${usd(spent)} already paid, this is $${usd(expectedCents)}, the cap is $${usd(DAILY_CAP_USD * 100)}.`);
    }
    if (!db.vault.vaultId) throw new HttpError(400, "Connect PayPal Vault in Settings first.");

    const limit = checkRateLimit(db, "capture", ip);
    if (!limit.ok) throw new HttpError(429, limit.reason);

    const existing = db.orders.find((o) => o.intentId === intent.id && o.status !== "COMPLETED");
    return {
      done: null,
      vaultId: db.vault.vaultId,
      amount: intent.amount,
      currency: CATALOG_CURRENCY,
      receiptHash: intent.receiptHash,
      existingPaypalOrderId: existing?.paypalOrderId,
      expectedCents,
    };
  });

  if (plan.done) return NextResponse.json({ order: plan.done, captured: true, duplicate: true });

  // 2. Talk to PayPal outside the lock.
  let paypalOrder: any = plan.existingPaypalOrderId
    ? await getOrder(plan.existingPaypalOrderId)
    : await createCaptureOrderWithVault({
        vaultId: plan.vaultId!,
        amount: plan.amount!,
        currency: plan.currency!,
        receiptHash: plan.receiptHash!,
        requestId: `relaypay-${intentId}`,
      });

  // The PayPal order must carry this exact receipt and amount before capture.
  const unit = paypalOrder.purchase_units?.[0];
  if (unit?.custom_id && unit.custom_id !== plan.receiptHash) {
    throw new HttpError(409, "The PayPal order carries a different custom_id; refusing to capture it.");
  }
  if (unit?.amount?.value && centsFromUsd(unit.amount.value) !== plan.expectedCents) {
    throw new HttpError(409, `The PayPal order amount ${unit.amount.value} doesn't match the approved amount ${plan.amount}.`);
  }
  paypalOrder = await ensureCaptured(paypalOrder);

  const capture = paypalOrder.purchase_units?.[0]?.payments?.captures?.[0];
  const captured = paypalOrder.status === "COMPLETED" && capture?.status === "COMPLETED";
  const status = captured
    ? "COMPLETED"
    : capture?.status || (paypalOrder.status === "COMPLETED" ? "CAPTURE_INCOMPLETE" : paypalOrder.status) || "UNKNOWN";

  // 3. Save the result atomically.
  const result = await mutate((db) => {
    const intent = db.intents.find((i) => i.id === intentId)!;
    let record: OrderRecord | undefined = db.orders.find((o) => o.intentId === intentId && o.paypalOrderId === paypalOrder.id);
    if (!record) {
      record = {
        id: uid(),
        intentId,
        paypalOrderId: paypalOrder.id,
        customId: plan.receiptHash!,
        amount: plan.amount!,
        currency: plan.currency!,
        status,
        createdAt: new Date().toISOString(),
      };
      db.orders.push(record);
    }
    record.captureId = capture?.id || record.captureId;
    record.status = status;
    record.customId = paypalOrder.purchase_units?.[0]?.custom_id || plan.receiptHash!;

    if (captured) {
      record.capturedAt = record.capturedAt || new Date().toISOString();
      if (intent && intent.status !== "CAPTURED") intent.status = "CAPTURED";
      addLedger(db, {
        actor: "PAYPAL",
        eventType: "ORDER_CAPTURED",
        intentId,
        orderId: record.id,
        amount: record.amount,
        note: `PayPal order ${paypalOrder.id}, capture ${capture?.id}, custom_id = receipt hash`,
      });
      // The supplies are now paid for: add them to the cafe's stock once.
      if (intent && !record.stockApplied && intent.product in db.inventory) {
        db.inventory[intent.product] = (db.inventory[intent.product] || 0) + Number(intent.quantity || 0);
        record.stockApplied = true;
        addLedger(db, {
          actor: "SYSTEM",
          eventType: "STOCK_RECEIVED",
          intentId,
          orderId: record.id,
          note: `${intent.quantity} × ${intent.product} added · ${db.inventory[intent.product]} on hand`,
        });
      }
    } else {
      addLedger(db, {
        actor: "PAYPAL",
        eventType: "ORDER_PENDING",
        intentId,
        orderId: record.id,
        amount: record.amount,
        note: `PayPal returned ${status}; the proposal stays approved until the capture completes.`,
      });
    }
    return { record, intent };
  });

  if (!captured) {
    return NextResponse.json(
      { order: result.record, captured: false, warning: `PayPal returned ${status}. The order exists but isn't captured yet.` },
      { status: 202 }
    );
  }

  void notifyOwner("payment_captured", {
    title: `Paid $${result.record.amount} for ${result.intent?.product}`,
    message: `PayPal capture ${result.record.captureId}. The receipt hash travels with the payment as custom_id.`,
    amount: result.record.amount,
    view: "receipts",
    reference: result.record.captureId,
  });
  return NextResponse.json({ order: result.record, captured: true });
});
