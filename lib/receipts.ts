import { createHash } from "crypto";
import type { PolicyChecks } from "@/lib/policy";

export type IntentReceipt = {
  intentId: string;
  product: string;
  quantity: number;
  amount: string;
  currency: string;
  rationale: string;
  alternatives: string[];
  approvedBy: string;
  approvedAt: string;
  agentId?: string;
  model?: string;
  policyVersion?: string;
  promptHash?: string;
  policyChecks?: PolicyChecks;
  highValueConfirmed?: boolean;
  /** Channel3 market price comparison, when the agent ran one. */
  marketCheck?: MarketCheck;
};

export type MarketCheck = {
  source: "channel3";
  query: string;
  offerCount: number;
  medianPrice: string | null;
  lowestPrice: string | null;
  catalogPrice: string;
  verdict: "BELOW_MARKET" | "AT_MARKET" | "ABOVE_MARKET" | "NO_DATA";
  checkedAt: string;
};

/**
 * Copy with every object's keys in sorted order. Postgres JSONB does not keep
 * key order (it stores keys by length, then alphabetically), so a receipt read
 * back from the database has its nested objects in a different order than the
 * one that was sealed. Sorting makes the hash independent of that order.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)])
    );
  }
  return value;
}

/**
 * Receipt is finalized ONLY on approval.
 * approvedBy + approvedAt + agent identity + policy version + the policy checks
 * that actually ran are added at approval time, then hashed.
 *
 * The hash therefore attests the human approval and the rules that applied,
 * not the agent's draft.
 */
export function canonicalReceipt(receipt: IntentReceipt): string {
  const canonical: Record<string, unknown> = {
    intentId: receipt.intentId,
    product: receipt.product,
    quantity: receipt.quantity,
    amount: receipt.amount,
    currency: receipt.currency,
    rationale: receipt.rationale,
    alternatives: receipt.alternatives,
    approvedBy: receipt.approvedBy,
    approvedAt: receipt.approvedAt,
    agentId: receipt.agentId || "relaypay-cafe-agent-1",
    model: receipt.model || "unknown",
    policyVersion: receipt.policyVersion || "policy-v1",
    promptHash: receipt.promptHash || "",
    policyChecks: sortKeys(receipt.policyChecks || null),
    highValueConfirmed: receipt.highValueConfirmed === true,
  };
  // Added only when present, so receipts sealed before the market check existed
  // still hash to the same value.
  if (receipt.marketCheck) canonical.marketCheck = sortKeys(receipt.marketCheck);
  return JSON.stringify(canonical);
}

export function hashReceipt(receipt: IntentReceipt): string {
  return createHash("sha256").update(canonicalReceipt(receipt)).digest("hex");
}

export function verifyReceipt(receipt: IntentReceipt, expectedHash: string): boolean {
  return hashReceipt(receipt) === expectedHash;
}
