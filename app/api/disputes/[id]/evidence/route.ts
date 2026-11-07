import { loadDB, HttpError } from "@/lib/store";
import { buildEvidencePdf } from "@/lib/evidencePdf";
import { buildTimeline } from "@/lib/disputeService";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Preview the evidence PDF for a dispute, built from RelayPay's stored records
 * with the same builder the submit route uses. Read-only: it never calls PayPal
 * and never submits anything. Submitting re-checks PayPal live and rebuilds it.
 */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const db = await loadDB();
  const dispute = db.disputes.find((d) => d.id === id);
  if (!dispute) throw new HttpError(404, "Dispute not found");
  const order = dispute.orderId ? db.orders.find((o) => o.id === dispute.orderId) : undefined;
  const intent = order ? db.intents.find((i) => i.id === order.intentId) : undefined;
  if (!order || !intent?.receiptHash) throw new HttpError(400, "This dispute has no linked approval receipt, so there is no evidence packet.");

  const pdf = await buildEvidencePdf({
    disputeId: dispute.paypalDisputeId,
    reason: dispute.reason,
    receiptHash: intent.receiptHash,
    approvedBy: intent.approvedBy,
    approvedAt: intent.approvedAt,
    paypalOrderId: order.paypalOrderId,
    captureId: order.captureId,
    product: `${intent.quantity} × ${intent.product}`,
    amount: intent.amount,
    classification: dispute.agentClassification,
    draft: dispute.agentDraft,
    hashVerified: !!dispute.hashVerified,
    hashSource: dispute.hashSource,
    disputeCustomId: dispute.paypalDisputeCustomId,
    vaultApprovedAt: db.vault.approvedAt,
    timeline: buildTimeline(db, order),
  });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="relaypay-evidence-${String(dispute.paypalDisputeId || id).replace(/[^A-Za-z0-9-]/g, "")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
});
