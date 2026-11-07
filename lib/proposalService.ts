import "server-only";
import { NextResponse } from "next/server";
import { proposePurchase } from "@/lib/agents";
import { addLedger, loadDB, mutate, uid, HttpError, type Intent } from "@/lib/store";
import { spentTodayCents } from "@/lib/policy";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { notifyOwner } from "@/lib/notify";

export const DEFAULT_TASK = "Check stock and reorder whatever is running low";

/**
 * Run the purchasing agent and store its proposal. Shared by the composer
 * ("agent" limit) and the guided walkthrough ("walkthrough", stricter limit).
 */
export async function runAgentProposal(req: Request, task: string, scope: "agent" | "walkthrough") {
  const ip = clientIp(req);
  await mutate((db) => {
    const limit = checkRateLimit(db, scope, ip);
    if (!limit.ok) throw new HttpError(429, limit.reason);
  });

  // The agent loop is slow (LLM + optional Channel3), so it runs outside the lock.
  const snapshot = await loadDB();
  const proposal = await proposePurchase(task, {
    spentTodayCents: spentTodayCents(snapshot.orders),
    inventory: snapshot.inventory,
  });

  const intent: Intent = {
    id: uid(),
    task,
    product: proposal.product,
    quantity: proposal.quantity,
    amount: proposal.amount,
    currency: proposal.currency,
    rationale: proposal.rationale,
    alternatives: proposal.alternatives,
    toolCalls: proposal.toolCalls,
    agentId: proposal.agentId,
    model: proposal.model,
    promptHash: proposal.promptHash,
    policyChecks: proposal.policyChecks,
    marketCheck: proposal.marketCheck,
    agentMode: proposal.agentMode,
    status: "PROPOSED",
    createdAt: new Date().toISOString(),
  };

  await mutate((db) => {
    db.intents.push(intent);
    addLedger(db, {
      actor: "AGENT",
      eventType: scope === "walkthrough" ? "JUDGE_PROPOSED" : "PROPOSED",
      intentId: intent.id,
      amount: intent.amount,
      note: `${proposal.agentMode} · ${proposal.toolCalls.length} tool calls · ${proposal.rationale}`,
    });
  });

  void notifyOwner("approval_needed", {
    title: `Café approval needed: ${intent.quantity} × ${intent.product}`,
    message: `The purchasing agent proposed a $${intent.amount} order. Nothing is charged until the café approves.`,
    amount: intent.amount,
    view: "purchases",
    reference: intent.id,
  });

  return NextResponse.json({ intent });
}
