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
