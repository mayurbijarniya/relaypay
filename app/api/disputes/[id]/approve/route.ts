import { NextResponse } from "next/server";
import { addLedger, mutate, HttpError } from "@/lib/store";
import { route } from "@/lib/http";

/** The owner approves the agent's drafted response. Nothing is sent yet. */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const dispute = await mutate((db) => {
    const dispute = db.disputes.find((d) => d.id === id);
    if (!dispute) throw new HttpError(404, "Dispute not found");
    if (dispute.submitted) throw new HttpError(409, "Evidence was already submitted.");
    if (dispute.resolution) throw new HttpError(409, `This dispute is already ${dispute.resolution.toLowerCase()}.`);
    dispute.merchantApproved = true;
    dispute.updatedAt = new Date().toISOString();
    addLedger(db, {
      actor: "MERCHANT",
      eventType: "DISPUTE_DRAFT_APPROVED",
      orderId: dispute.orderId,
      disputeId: dispute.id,
      note: `Supplier approved the ${dispute.agentRecommendation === "CONTEST" ? "contest" : "refund"} response`,
    });
    return dispute;
  });
  return NextResponse.json({ dispute });
});
