import { NextResponse } from "next/server";
import { addLedger, loadDB, mutate, HttpError } from "@/lib/store";
import { disputeActions, getDispute, provideEvidence, resolvePayPalCustomId } from "@/lib/paypal/disputes";
import { getCapture } from "@/lib/paypal/orders";
import { buildEvidencePdf } from "@/lib/evidencePdf";
import { hashReceipt } from "@/lib/receipts";
import { EVIDENCE_NOTES_LIMIT, isPayPalVerifiedSource } from "@/lib/agents";
import { CLOSED_STATUSES, buildTimeline, paypalFields } from "@/lib/disputeService";
import { notifyOwner } from "@/lib/notify";
import { route } from "@/lib/http";

const IN_FLIGHT_MS = 2 * 60_000;

/**
 * Send the approved response and the evidence PDF to PayPal. Irreversible, so
 * RelayPay re-reads the dispute and re-verifies the hash against PayPal's own
 * record immediately before submitting, and holds an in-flight lock so a
 * double click can never submit twice.
 */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;

  // 1. Validate and take the in-flight lock.
  await mutate((db) => {
    const d = db.disputes.find((x) => x.id === id);
    if (!d) throw new HttpError(404, "Dispute not found");
    if (d.simulator || d.paypalDisputeId === "simulated") throw new HttpError(400, "Samples are never sent to PayPal.");
    if (!d.merchantApproved) throw new HttpError(400, "Approve the response first.");
    if (d.submitted) throw new HttpError(409, "Evidence was already submitted.");
    if (d.resolution) throw new HttpError(409, `This dispute is already ${d.resolution.toLowerCase()}.`);
    if (d.agentRecommendation !== "CONTEST") {
      throw new HttpError(400, "The dispute agent recommends a refund, so there is no evidence to contest with. Accept the claim instead.");
    }
    if (!d.hashVerified || !isPayPalVerifiedSource(d.hashSource)) {
      throw new HttpError(400, "Refusing to contest: the receipt hash was not verified against PayPal's own records.");
    }
    const inFlight = (d as any).submittingAt && Date.now() - Number((d as any).submittingAt) < IN_FLIGHT_MS;
    if (inFlight) throw new HttpError(409, "Evidence is already being sent. Wait a moment and refresh.");
    (d as any).submittingAt = Date.now();
  });

  const release = () =>
    mutate((db) => {
      const d = db.disputes.find((x) => x.id === id);
      if (d) delete (d as any).submittingAt;
    }).catch(() => undefined);

  try {
    const snapshot = await loadDB();
    const dispute = snapshot.disputes.find((d) => d.id === id)!;
    const order = dispute.orderId ? snapshot.orders.find((o) => o.id === dispute.orderId) : undefined;
    const intent = order ? snapshot.intents.find((i) => i.id === order.intentId) : undefined;
    if (!order || !intent?.receiptPayload || !intent.receiptHash || !intent.approvedBy) {
      throw new HttpError(400, "The linked approved receipt is missing.");
    }
    if (hashReceipt(intent.receiptPayload) !== intent.receiptHash) {
      throw new HttpError(409, "The stored receipt no longer matches its hash; refusing to submit.");
    }

    // 2. Fresh PayPal state.
    const fresh: any = await getDispute(dispute.paypalDisputeId);
    if (CLOSED_STATUSES.has(String(fresh.status || "").toUpperCase())) {
      throw new HttpError(409, `PayPal reports this dispute as ${fresh.status}; evidence can no longer be submitted.`);
    }
    const actions = disputeActions(fresh);
    if (actions.length && !actions.includes("provide-evidence")) {
      throw new HttpError(
        409,
        `PayPal isn't asking for evidence yet (status ${fresh.status}). Use “Advance in sandbox” to move it to the evidence stage.`
      );
    }

    // The dispute must be about the same capture the receipt was paid with.
    const tx = Array.isArray(fresh.disputed_transactions) ? fresh.disputed_transactions[0] : undefined;
    if (tx?.seller_transaction_id && order.captureId && tx.seller_transaction_id !== order.captureId) {
      throw new HttpError(409, `PayPal says this dispute is for capture ${tx.seller_transaction_id}, not ${order.captureId}. Refusing to submit.`);
    }
    const paypalCopy = await resolvePayPalCustomId({ dispute: fresh, captureId: order.captureId, paypalOrderId: order.paypalOrderId });
    if (!paypalCopy.customId || paypalCopy.customId !== intent.receiptHash) {
      throw new HttpError(409, "PayPal's records no longer contain this receipt hash; refusing to submit unverified evidence.", {
        checked: paypalCopy.checked,
      });
    }
    const hashSource = `PAYPAL_${paypalCopy.origin}_CUSTOM_ID`;
    const capture = order.captureId ? await getCapture(order.captureId).catch(() => null) : null;

    // 3. Build the evidence packet.
    const pdf = await buildEvidencePdf({
      disputeId: dispute.paypalDisputeId,
      reason: fresh.reason || dispute.reason,
      receiptHash: intent.receiptHash,
      approvedBy: intent.approvedBy,
      approvedAt: intent.approvedAt,
      paypalOrderId: order.paypalOrderId,
      captureId: order.captureId,
      product: `${intent.quantity} × ${intent.product}`,
      amount: intent.amount,
      classification: dispute.agentClassification,
      draft: dispute.agentDraft,
      hashVerified: true,
      hashSource,
      disputeCustomId: paypalCopy.customId,
      vaultApprovedAt: snapshot.vault.approvedAt,
      capture: capture
        ? { status: capture.status, amount: capture.amount?.value, currency: capture.amount?.currency_code, createTime: capture.create_time }
        : undefined,
      timeline: buildTimeline(snapshot, order),
    });
    const evidences = (Array.isArray(dispute.agentPayload?.evidences) ? dispute.agentPayload.evidences : [{ evidence_type: "OTHER" }]).map(
      (e: any) => ({
        evidence_type: e?.evidence_type || "OTHER",
        notes: String(e?.notes || dispute.agentDraft || "Evidence packet attached.").slice(0, EVIDENCE_NOTES_LIMIT),
      })
    );

    // 4. Submit. This is the irreversible call.
    const result = await provideEvidence(dispute.paypalDisputeId, { evidences }, { name: "relaypay-evidence.pdf", buffer: pdf, mime: "application/pdf" });

    const saved = await mutate((db) => {
      const d = db.disputes.find((x) => x.id === id)!;
      delete (d as any).submittingAt;
      Object.assign(d, paypalFields(fresh));
      d.submitted = true;
      d.status = "EVIDENCE_SUBMITTED";
      d.resolution = "CONTESTED";
      d.hashVerified = true;
      d.hashSource = hashSource;
      d.paypalDisputeCustomId = paypalCopy.customId;
      d.paypalResponse = result;
      d.updatedAt = new Date().toISOString();
      addLedger(db, {
        actor: "MERCHANT",
        eventType: "EVIDENCE_SUBMITTED",
        intentId: order.intentId,
        orderId: order.id,
        disputeId: d.id,
        note: `Response and evidence PDF sent to PayPal dispute ${d.paypalDisputeId}`,
      });
      return d;
    });

    void notifyOwner("evidence_submitted", {
      title: "Evidence sent to PayPal",
      message: `Dispute ${saved.paypalDisputeId}: the response and evidence PDF were submitted.`,
      view: "disputes",
      reference: saved.paypalDisputeId,
    });
    return NextResponse.json({ submitted: true, dispute: saved, pdfAttached: true });
  } catch (error) {
    await release();
    throw error;
  }
});
