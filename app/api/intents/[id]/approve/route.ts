import { NextResponse } from "next/server";
import { addLedger, mutate, HttpError } from "@/lib/store";
import { hashReceipt, type IntentReceipt } from "@/lib/receipts";
import { AGENT_ID, AGENT_MODEL } from "@/lib/agents";
import { CATALOG, CATALOG_CURRENCY, HIGH_VALUE_USD, MAX_QUANTITY, centsFromUsd, evaluatePolicy, matchProduct, spentTodayCents, usd } from "@/lib/policy";
import { readJson, route } from "@/lib/http";

/**
 * The owner approves a proposal. This is the moment the receipt is sealed:
 * the catalog price is recomputed, the policy runs again, and the approval,
 * agent identity, policy checks and market check are hashed with SHA-256.
 */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const body = await readJson(req);
  const approvedBy = String(body.approvedBy || "cafe-owner").trim().slice(0, 80) || "cafe-owner";

  const intent = await mutate((db) => {
    const intent = db.intents.find((i) => i.id === id);
    if (!intent) throw new HttpError(404, "Proposal not found");
    if (intent.status !== "PROPOSED") throw new HttpError(409, `This proposal is already ${intent.status.toLowerCase()}.`);

    // The catalog is the only source of truth for price and product.
    const product = matchProduct(intent.product);
    if (!product) throw new HttpError(400, `Unknown product "${intent.product}". Ask the agent again.`);
    const quantity = Math.floor(Number(intent.quantity));
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new HttpError(400, `Quantity must be between 1 and ${MAX_QUANTITY}.`);
    }
    if (intent.currency && intent.currency !== CATALOG_CURRENCY) {
      throw new HttpError(409, `Unsupported currency "${intent.currency}". The catalog is priced in ${CATALOG_CURRENCY}.`);
    }

    const checks = evaluatePolicy({ unitPriceCents: CATALOG[product].priceCents, quantity, spentTodayCents: spentTodayCents(db.orders) });
    if (centsFromUsd(intent.amount) !== centsFromUsd(checks.computedAmount)) {
      throw new HttpError(409, `Proposal amount $${intent.amount} doesn't match $${checks.catalogPrice} × ${quantity} = $${checks.computedAmount}. Ask the agent again.`, {
        policyChecks: checks,
      });
    }
    if (!checks.withinDailyCap) {
      throw new HttpError(400, `Over today's cap: this is $${checks.computedAmount} and only $${checks.remainingToday} of $${checks.dailyCap} is left.`, {
        policyChecks: checks,
      });
    }
    if (checks.requiresOwnerConfirmation && body.confirmHighValue !== true) {
      throw new HttpError(428, `$${checks.computedAmount} is over the $${usd(HIGH_VALUE_USD * 100)} high-value limit and needs your explicit confirmation.`, {
        requiresHighValueConfirmation: true,
        policyChecks: checks,
      });
    }

    const approvedAt = new Date().toISOString();
    intent.product = product;
    intent.quantity = quantity;
    intent.amount = checks.computedAmount;
    intent.currency = CATALOG_CURRENCY;

    const receiptPayload: IntentReceipt = {
      intentId: intent.id,
      product,
      quantity,
      amount: checks.computedAmount,
      currency: CATALOG_CURRENCY,
      rationale: intent.rationale,
      alternatives: intent.alternatives,
      approvedBy,
      approvedAt,
      agentId: intent.agentId || AGENT_ID,
      model: intent.model || AGENT_MODEL,
      policyVersion: checks.policyVersion,
      promptHash: intent.promptHash || "",
      policyChecks: checks,
      highValueConfirmed: checks.requiresOwnerConfirmation && body.confirmHighValue === true,
      ...(intent.marketCheck ? { marketCheck: intent.marketCheck } : {}),
    };
    const receiptHash = hashReceipt(receiptPayload);

    intent.status = "APPROVED";
    intent.approvedBy = approvedBy;
    intent.approvedAt = approvedAt;
    intent.policyChecks = checks;
    intent.receiptPayload = receiptPayload;
    intent.receiptHash = receiptHash;

    addLedger(db, {
      actor: "OWNER",
      eventType: "APPROVED",
      intentId: intent.id,
      amount: intent.amount,
      note: `Receipt sealed (${checks.policyVersion}${receiptPayload.highValueConfirmed ? ", high value confirmed" : ""}${
        intent.marketCheck ? `, market ${intent.marketCheck.verdict.toLowerCase().replace(/_/g, " ")}` : ""
      }), hash ${receiptHash.slice(0, 12)}…`,
    });
    return intent;
  });

  return NextResponse.json({ intent });
});
