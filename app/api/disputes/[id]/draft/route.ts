import { NextResponse } from "next/server";
import { getDispute } from "@/lib/paypal/disputes";
import { draftAndSave, SAMPLE_ID } from "@/lib/disputeService";
import { mutate, HttpError } from "@/lib/store";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { readJson, route } from "@/lib/http";

const SAMPLE_REASONS = new Set(["UNAUTHORISED", "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED"]);

/**
 * Draft a dispute response.
 * - `id` = a PayPal dispute ID: the dispute is read from PayPal (never from the body).
 * - `id` = "simulated": a labelled sample linked to a real capture; never sent.
 */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id: rawId } = await ctx.params;
  const id = decodeURIComponent(rawId).trim();
  const body = await readJson(req);
  const ip = clientIp(req);

  await mutate((db) => {
    const limit = checkRateLimit(db, "agent", ip);
    if (!limit.ok) throw new HttpError(429, limit.reason);
  });

  if (id === SAMPLE_ID) {
    const dispute = await draftAndSave({
      paypalDisputeId: SAMPLE_ID,
      paypalDispute: null,
      hint: { captureId: body.captureId, paypalOrderId: body.paypalOrderId },
      sampleReason: SAMPLE_REASONS.has(String(body.reason)) ? String(body.reason) : "UNAUTHORISED",
      source: "SAMPLE",
    });
    return NextResponse.json({ dispute });
  }

  if (!/^PP-[A-Z]-[A-Z0-9-]{4,40}$/i.test(id)) {
    throw new HttpError(400, "That doesn't look like a PayPal dispute ID. It should start with PP-D- or PP-R-.");
  }
  const paypalDispute = await getDispute(id);
  const dispute = await draftAndSave({
    paypalDisputeId: paypalDispute.dispute_id || id,
    paypalDispute,
    source: "MANUAL",
  });
  return NextResponse.json({ dispute });
});
