import { NextResponse } from "next/server";
import { addLedger, loadDB, mutate, HttpError } from "@/lib/store";
import { disputeActions, escalateDispute, getDispute, requireSellerEvidence } from "@/lib/paypal/disputes";
import { CLOSED_STATUSES, paypalFields } from "@/lib/disputeService";
import { isSandbox } from "@/lib/env";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { route } from "@/lib/http";

/**
 * Sandbox only: move a real sandbox dispute to the stage where PayPal accepts
 * seller evidence. Follows the HATEOAS actions PayPal currently offers:
 * an inquiry is escalated to a claim (OPEN → UNDER_REVIEW), then
 * require-evidence moves it to WAITING_FOR_SELLER_RESPONSE.
 */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  if (!isSandbox()) throw new HttpError(403, "This is a sandbox-only testing step.");
  const { id } = await ctx.params;
  const ip = clientIp(req);
  await mutate((db) => {
    const limit = checkRateLimit(db, "paypal", ip);
    if (!limit.ok) throw new HttpError(429, limit.reason);
  });

  const snapshot = await loadDB();
  const record = snapshot.disputes.find((d) => d.id === id);
  if (!record) throw new HttpError(404, "Dispute not found");
  if (record.simulator) throw new HttpError(400, "Samples have no PayPal dispute to advance.");

  const before: any = await getDispute(record.paypalDisputeId);
  if (CLOSED_STATUSES.has(String(before.status || "").toUpperCase())) {
    throw new HttpError(409, `PayPal reports this dispute as ${before.status}.`);
  }
  const actions = disputeActions(before);

  let step: "ready" | "escalated" | "evidence_requested";
  if (actions.includes("provide-evidence")) {
    step = "ready";
  } else if (actions.includes("escalate")) {
    await escalateDispute(record.paypalDisputeId);
    step = "escalated";
  } else if (actions.includes("require-evidence")) {
    await requireSellerEvidence(record.paypalDisputeId);
    step = "evidence_requested";
  } else {
    throw new HttpError(
      409,
      `PayPal offers no sandbox step for this dispute right now (status ${before.status}). New disputes can take a few minutes before their actions appear.`
    );
  }

  const after: any = step === "ready" ? before : await getDispute(record.paypalDisputeId);
  const saved = await mutate((db) => {
    const d = db.disputes.find((x) => x.id === id)!;
    Object.assign(d, paypalFields(after));
    d.updatedAt = new Date().toISOString();
    if (step !== "ready") {
      addLedger(db, {
        actor: "SYSTEM",
        eventType: "DISPUTE_ADVANCED",
        orderId: d.orderId,
        disputeId: d.id,
        note: `${step === "escalated" ? "Escalated to a claim" : "Requested seller evidence"} · PayPal status ${after.status}`,
      });
    }
    return d;
  });

  const ready = disputeActions(after).includes("provide-evidence");
  return NextResponse.json({
    step,
    ready,
    status: after.status,
    dispute: saved,
    message: ready
      ? "PayPal is waiting for your evidence. You can send it now."
      : `Done: ${step === "escalated" ? "escalated to a claim" : "evidence requested"}. PayPal status is ${after.status}. Run this again if PayPal offers another step.`,
  });
});
