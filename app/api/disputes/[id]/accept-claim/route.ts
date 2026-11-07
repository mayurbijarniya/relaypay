import { NextResponse } from "next/server";
import { addLedger, mutate, HttpError } from "@/lib/store";
import { acceptClaim, getDispute } from "@/lib/paypal/disputes";
import { CLOSED_STATUSES, paypalFields } from "@/lib/disputeService";
import { notifyOwner } from "@/lib/notify";
import { route } from "@/lib/http";

const IN_FLIGHT_MS = 2 * 60_000;

/** Accept the buyer's claim. PayPal refunds the buyer. Irreversible. */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;

  const paypalDisputeId = await mutate((db) => {
    const d = db.disputes.find((x) => x.id === id);
    if (!d) throw new HttpError(404, "Dispute not found");
    if (d.simulator || d.paypalDisputeId === "simulated") throw new HttpError(400, "Samples are never sent to PayPal.");
    if (d.submitted) throw new HttpError(409, "Evidence was already submitted; the claim can't be accepted from RelayPay.");
    if (d.resolution) throw new HttpError(409, `This dispute is already ${d.resolution.toLowerCase()}.`);
    if ((d as any).acceptingAt && Date.now() - Number((d as any).acceptingAt) < IN_FLIGHT_MS) {
      throw new HttpError(409, "The refund is already being processed. Wait a moment and refresh.");
    }
    (d as any).acceptingAt = Date.now();
    return d.paypalDisputeId;
  });

  try {
    // Check PayPal's current state so a stale record can't refund a closed case.
    const fresh: any = await getDispute(paypalDisputeId);
    if (CLOSED_STATUSES.has(String(fresh.status || "").toUpperCase())) {
      throw new HttpError(409, `PayPal reports this dispute as ${fresh.status}; there is nothing left to accept.`);
    }
    const result = await acceptClaim(paypalDisputeId, "The merchant accepts the claim and agrees to refund the buyer.");

    const saved = await mutate((db) => {
      const d = db.disputes.find((x) => x.id === id)!;
      delete (d as any).acceptingAt;
      Object.assign(d, paypalFields(fresh));
      d.merchantApproved = true;
      d.resolution = "ACCEPTED";
      d.status = "CLAIM_ACCEPTED";
      d.paypalResponse = result;
      d.updatedAt = new Date().toISOString();
      addLedger(db, {
        actor: "MERCHANT",
        eventType: "CLAIM_ACCEPTED",
        orderId: d.orderId,
        disputeId: d.id,
        note: "Accepted the claim; PayPal refunds the buyer. No evidence was submitted.",
      });
      return d;
    });
    void notifyOwner("claim_accepted", {
      title: "Claim accepted",
      message: `Dispute ${paypalDisputeId}: PayPal will refund the buyer.`,
      view: "disputes",
      reference: paypalDisputeId,
    });
    return NextResponse.json({ accepted: true, dispute: saved });
  } catch (error) {
    await mutate((db) => {
      const d = db.disputes.find((x) => x.id === id);
      if (d) delete (d as any).acceptingAt;
    }).catch(() => undefined);
    throw error;
  }
});
