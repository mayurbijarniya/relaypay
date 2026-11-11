import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalReceipt, hashReceipt, verifyReceipt, type IntentReceipt } from "../lib/receipts.ts";

const base: IntentReceipt = {
  intentId: "intent-1",
  product: "Oat milk case (12)",
  quantity: 5,
  amount: "120.00",
  currency: "USD",
  rationale: "Restock for the week.",
  alternatives: [],
  approvedBy: "cafe-owner",
  approvedAt: "2026-11-05T15:00:00.000Z",
  agentId: "relaypay-cafe-agent-1",
  model: "test-model",
  policyVersion: "policy-v3",
  promptHash: "abc123",
  highValueConfirmed: true,
};

test("the receipt hash is a deterministic SHA-256 that fits PayPal custom_id", () => {
  const hash = hashReceipt(base);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, hashReceipt({ ...base }));
  assert.ok(hash.length <= 127, "custom_id allows 127 characters");
});

test("changing any sealed field changes the hash (tamper evidence)", () => {
  const hash = hashReceipt(base);
  for (const change of [
    { amount: "1.00" },
    { quantity: 6 },
    { product: "Sugar 10lb bag" },
    { approvedBy: "someone-else" },
    { approvedAt: "2026-11-05T15:00:01.000Z" },
    { highValueConfirmed: false },
    { model: "other-model" },
  ]) {
    const altered = { ...base, ...change } as IntentReceipt;
    assert.notEqual(hashReceipt(altered), hash, `changing ${Object.keys(change)[0]} must change the hash`);
    assert.equal(verifyReceipt(altered, hash), false);
  }
  assert.equal(verifyReceipt(base, hash), true);
});

test("receipts sealed before the market check existed still verify", () => {
  // marketCheck is only added to the canonical form when present.
  assert.equal(canonicalReceipt(base).includes("marketCheck"), false);
  const withMarket: IntentReceipt = {
    ...base,
    marketCheck: {
      source: "channel3",
      query: "oat milk",
      offerCount: 4,
      medianPrice: "26.00",
      lowestPrice: "22.00",
      catalogPrice: "24.00",
      verdict: "AT_MARKET",
      checkedAt: "2026-11-05T14:59:00.000Z",
    },
  };
  assert.notEqual(hashReceipt(withMarket), hashReceipt(base), "the market check is sealed into the hash");
});

test("the hash does not depend on the key order inside nested objects", () => {
  const policyChecks = { policyVersion: "policy-v3", catalogPrice: "24.00", quantity: 2, computedAmount: "48.00", dailyCap: "500.00", spentToday: "0.00", remainingToday: "500.00", withinDailyCap: true, highValue: false, requiresOwnerConfirmation: false, catalogMatched: true, withinQuantityLimit: true } as any;
  const marketCheck = { source: "channel3", query: "Oat milk", offerCount: 3, medianPrice: "20.00", lowestPrice: "18.00", catalogPrice: "24.00", verdict: "ABOVE_MARKET", checkedAt: "2026-11-10T00:00:00.000Z" } as any;
  const reverse = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).reverse());
  const a = { ...base, policyChecks, marketCheck };
  const b = { ...base, policyChecks: reverse(policyChecks), marketCheck: reverse(marketCheck) } as IntentReceipt;
  assert.equal(hashReceipt(a), hashReceipt(b));
  assert.notEqual(hashReceipt(a), hashReceipt({ ...a, policyChecks: { ...policyChecks, computedAmount: "1.00" } }), "values still matter");
});
