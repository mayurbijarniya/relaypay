import "server-only";
import { addLedger, loadDB, mutate, uid, HttpError, type DB, type DisputeRecord, type OrderRecord } from "@/lib/store";
import { disputeActions, resolvePayPalCustomId } from "@/lib/paypal/disputes";
import { getCapture } from "@/lib/paypal/orders";
import { draftDisputeResponse, type PayPalConfirmation, type TimelineEntry } from "@/lib/agents";
import { eventLabel } from "@/lib/format";

/**
 * Shared dispute pipeline used by the draft route, the PayPal webhook, the
 * "check PayPal for disputes" sync, and the sandbox dispute creator:
 *
 *   PayPal dispute → link to a RelayPay capture → read PayPal's copy of the
 *   receipt hash → build the provenance timeline → run the dispute agent →
 *   save (or refresh) the case.
 *
 * Network calls happen before the database lock; the save is atomic.
 */

export const CLOSED_STATUSES = new Set(["RESOLVED", "CLOSED", "CANCELLED"]);
export const SAMPLE_ID = "simulated";
const SAMPLE_REASONS = new Set(["UNAUTHORISED", "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED"]);

export function findOrderForDispute(db: DB, paypalDispute: any, hint?: { captureId?: string; paypalOrderId?: string }) {
  const tx = Array.isArray(paypalDispute?.disputed_transactions) ? paypalDispute.disputed_transactions[0] : undefined;
  const ids = [tx?.seller_transaction_id, tx?.buyer_transaction_id, hint?.captureId].filter(Boolean) as string[];
  let order: OrderRecord | undefined = db.orders.find((o) => ids.some((id) => o.captureId === id || o.paypalOrderId === id));
  if (!order && hint?.paypalOrderId) order = db.orders.find((o) => o.paypalOrderId === hint.paypalOrderId);
  return { order, sellerTransactionId: tx?.seller_transaction_id as string | undefined };
}

export function buildTimeline(db: DB, order?: OrderRecord): TimelineEntry[] {
  if (!order) return [];
  const entries: TimelineEntry[] = [];
  if (db.vault.approvedAt) entries.push({ at: db.vault.approvedAt, actor: "PayPal", event: "Buyer saved PayPal for future payments (Vault)" });
  for (const e of db.ledger) {
    if (e.intentId !== order.intentId && e.orderId !== order.id) continue;
    entries.push({ at: e.createdAt, actor: actorName(e.actor), event: eventLabel(e.eventType), detail: e.amount ? `$${e.amount}` : undefined });
  }
  for (const ev of db.events) {
    if (!order.captureId || ev.resourceId !== order.captureId) continue;
    entries.push({ at: ev.receivedAt, actor: "PayPal", event: `Webhook ${ev.eventType}`, detail: ev.source === "REAL" ? "signature verified" : "simulator" });
  }
  return entries.sort((a, b) => a.at.localeCompare(b.at)).slice(-20);
}

function actorName(actor: string) {
  return actor === "AGENT" ? "AI agent" : actor === "OWNER" ? "Café owner" : actor === "MERCHANT" ? "Supplier" : actor === "PAYPAL" ? "PayPal" : "RelayPay";
}

async function confirmationFor(captureId?: string): Promise<PayPalConfirmation | null> {
  if (!captureId) return null;
  const capture = await getCapture(captureId);
  return {
    captureId,
    status: String(capture?.status || "UNKNOWN"),
    amount: capture?.amount?.value,
    currency: capture?.amount?.currency_code,
    customId: capture?.custom_id,
    createTime: capture?.create_time,
  };
}

/** Fields copied from a PayPal dispute onto the RelayPay case. */
export function paypalFields(paypalDispute: any) {
  return {
    status: String(paypalDispute?.status || "OPEN"),
    reason: String(paypalDispute?.reason || "UNKNOWN"),
    amount: paypalDispute?.dispute_amount?.value ? String(paypalDispute.dispute_amount.value) : undefined,
    sellerResponseDueDate: paypalDispute?.seller_response_due_date || undefined,
    paypalLinks: disputeActions(paypalDispute),
  };
}

export async function draftAndSave(input: {
  /** PayPal dispute ID, or "simulated" for a sample. */
  paypalDisputeId: string;
  /** Full dispute object read from PayPal (null for a sample). */
  paypalDispute: any | null;
  /** For samples: which capture to link to. */
  hint?: { captureId?: string; paypalOrderId?: string };
  sampleReason?: string;
  source: "MANUAL" | "WEBHOOK" | "SYNC" | "SANDBOX_CREATE" | "SAMPLE";
}): Promise<DisputeRecord> {
  const sample = input.paypalDisputeId === SAMPLE_ID;
  const snapshot = await loadDB();

  if (!sample && CLOSED_STATUSES.has(String(input.paypalDispute?.status || "").toUpperCase())) {
    throw new HttpError(409, `Dispute ${input.paypalDisputeId} is ${input.paypalDispute.status} and can no longer be drafted.`);
  }

  let { order, sellerTransactionId } = findOrderForDispute(snapshot, input.paypalDispute, input.hint);
  if (sample && !order) order = [...snapshot.orders].reverse().find((o) => o.status === "COMPLETED" && o.captureId);
  if (sample && !order) {
    throw new HttpError(400, "Pay for a purchase first. The sample dispute links to a real PayPal capture.");
  }
  const intent = order ? snapshot.intents.find((i) => i.id === order!.intentId) : undefined;

  const existing = snapshot.disputes.find((d) =>
    sample ? (d.simulator || d.paypalDisputeId === SAMPLE_ID) && d.orderId === order?.id : d.paypalDisputeId === input.paypalDisputeId && !d.simulator
  );
  if (existing && (existing.submitted || existing.resolution)) {
    throw new HttpError(
      409,
      existing.submitted ? "Evidence was already submitted for this dispute; it cannot be re-drafted." : `This dispute is already ${existing.resolution}.`
    );
  }

  // PayPal's copy of the hash always comes from a PayPal read. A sample has no
  // PayPal dispute record, so it goes straight to the real capture and order.
  const paypalCopy = await resolvePayPalCustomId({
    dispute: sample ? undefined : input.paypalDispute,
    captureId: order?.captureId || sellerTransactionId,
    paypalOrderId: order?.paypalOrderId,
  });

  const fields = sample
    ? {
        status: "OPEN",
        reason: SAMPLE_REASONS.has(String(input.sampleReason)) ? String(input.sampleReason) : "UNAUTHORISED",
        amount: order?.amount,
        sellerResponseDueDate: undefined,
        paypalLinks: [] as string[],
      }
    : paypalFields(input.paypalDispute);

  const captureForConfirmation = order?.captureId || sellerTransactionId;
  const draft = await draftDisputeResponse({
    reason: fields.reason,
    status: fields.status,
    receiptHash: intent?.receiptHash,
    receiptPayload: intent?.receiptPayload,
    paypalOrderId: order?.paypalOrderId,
    captureId: order?.captureId || sellerTransactionId,
    approvedBy: intent?.approvedBy,
    approvedAt: intent?.approvedAt,
    product: intent ? `${intent.quantity} × ${intent.product}` : undefined,
    amount: fields.amount || order?.amount,
    vaultApprovedAt: snapshot.vault.approvedAt,
    disputeCustomId: paypalCopy.customId,
    disputeCustomIdOrigin: paypalCopy.origin,
    timeline: buildTimeline(snapshot, order),
    fetchCapture: () => confirmationFor(captureForConfirmation),
  });

  return mutate((db) => {
    const current = db.disputes.find((d) =>
      sample ? (d.simulator || d.paypalDisputeId === SAMPLE_ID) && d.orderId === order?.id : d.paypalDisputeId === input.paypalDisputeId && !d.simulator
    );
    if (current && (current.submitted || current.resolution)) {
      throw new HttpError(409, "This dispute changed while the agent was working. Refresh and try again.");
    }
    const record: DisputeRecord = {
      id: current?.id || uid(),
      paypalDisputeId: input.paypalDisputeId,
      orderId: order?.id,
      captureId: order?.captureId || sellerTransactionId,
      ...fields,
      agentClassification: draft.classification,
      agentDraft: draft.draft,
      agentPayload: draft.payload,
      agentRecommendation: draft.recommendation,
      agentDecisionReason: draft.decisionReason,
      hashVerified: draft.hashVerified,
      hashSource: draft.hashSource,
      paypalDisputeCustomId: draft.paypalDisputeCustomId,
      toolCalls: draft.toolCalls,
      // A new draft always needs a fresh approval.
      merchantApproved: false,
      submitted: false,
      simulator: sample,
      rawDisputeJson: input.paypalDispute || undefined,
      createdAt: current?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (current) Object.assign(current, record);
    else db.disputes.push(record);

    const eventType = sample
      ? "SIMULATED_DISPUTE_DRAFTED"
      : input.source === "WEBHOOK"
        ? "DISPUTE_WEBHOOK_AUTO_DRAFTED"
        : input.source === "SYNC"
          ? "DISPUTE_SYNCED_DRAFTED"
          : "DISPUTE_DRAFTED";
    addLedger(db, {
      actor: "AGENT",
      eventType,
      intentId: order?.intentId,
      orderId: order?.id,
      disputeId: record.id,
      note: `${draft.classification} — recommends ${draft.recommendation}; hash ${draft.hashVerified ? "verified" : "not verified"} (${draft.hashSource})`,
    });
    return current || record;
  });
}
