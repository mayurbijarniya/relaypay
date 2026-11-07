import { NextResponse } from "next/server";
import { addLedger, mutate, HttpError } from "@/lib/store";
import { route } from "@/lib/http";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const intent = await mutate((db) => {
    const intent = db.intents.find((i) => i.id === id);
    if (!intent) throw new HttpError(404, "Proposal not found");
    if (intent.status !== "PROPOSED") throw new HttpError(409, "Only a proposal that is still awaiting approval can be rejected.");
    intent.status = "REJECTED";
    addLedger(db, { actor: "OWNER", eventType: "REJECTED", intentId: intent.id, amount: intent.amount, note: intent.product });
    return intent;
  });
  return NextResponse.json({ intent });
});
