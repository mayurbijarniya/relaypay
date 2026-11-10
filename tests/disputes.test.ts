import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { setupEnv, installFakeNetwork, call } from "./helpers.ts";

setupEnv();
const net = installFakeNetwork();
after(() => net.restore());

let loaded: Awaited<ReturnType<typeof loadAll>> | undefined;
async function loadAll() {
  return {
    store: await import("@/lib/store"),
    receipts: await import("@/lib/receipts"),
    agents: await import("@/lib/agents"),
    submit: (await import("@/app/api/disputes/[id]/submit/route")).POST,
  };
}
const m = () => (loaded ??= loadAll());

const receipt = {
  intentId: "i1", product: "Oat milk case (12)", quantity: 2, amount: "48.00", currency: "USD", rationale: "Stock is low.", alternatives: [] as string[],
  approvedBy: "cafe-owner", approvedAt: "2026-11-09T12:00:00.000Z", agentId: "relaypay-cafe-agent-1", model: "test-model", policyVersion: "policy-v3", promptHash: "abc", highValueConfirmed: false,
};

async function agentInput(over: Record<string, unknown> = {}) {
  const { receipts } = await m();
  const hash = receipts.hashReceipt(receipt);
  return {
    hash,
    input: {
      reason: "UNAUTHORISED", status: "WAITING_FOR_SELLER_RESPONSE", receiptHash: hash, receiptPayload: receipt, paypalOrderId: "ORD-1", captureId: "CAP-ORD-1",
      approvedBy: "cafe-owner", approvedAt: receipt.approvedAt, product: "2 × Oat milk case (12)", amount: "48.00", disputeCustomId: hash, disputeCustomIdOrigin: "CAPTURE" as const,
      fetchCapture: async () => null, ...over,
    },
  };
}

// ---------------------------------------------------------------------------
// The dispute agent (no LLM key: the deterministic path, labelled FALLBACK)
// ---------------------------------------------------------------------------

test("contests only when PayPal's own record holds the receipt hash", async () => {
  const { agents } = await m();
  const { input } = await agentInput();
  const draft = await agents.draftDisputeResponse(input);
  assert.equal(draft.recommendation, "CONTEST");
  assert.equal(draft.hashVerified, true);
  assert.equal(draft.hashSource, "PAYPAL_CAPTURE_CUSTOM_ID");
  assert.equal(draft.overriddenByPolicy, false);
});

test("a matching copy that only RelayPay holds is not enough to contest", async () => {
  const { agents } = await m();
  const { input } = await agentInput({ disputeCustomId: undefined, disputeCustomIdOrigin: undefined });
  const draft = await agents.draftDisputeResponse(input);
  assert.equal(draft.hashSource, "STORED_RECEIPT");
  assert.equal(draft.hashVerified, false);
  assert.equal(draft.recommendation, "ACCEPT");
});

test("a receipt hash that differs from PayPal's record means accept the claim", async () => {
  const { agents } = await m();
  const { input } = await agentInput({ disputeCustomId: "c".repeat(64) });
  const draft = await agents.draftDisputeResponse(input);
  assert.equal(draft.hashSource, "MISMATCH");
  assert.equal(draft.recommendation, "ACCEPT");
});

test("no linked receipt means accept the claim", async () => {
  const { agents } = await m();
  const { input } = await agentInput({ receiptHash: undefined, receiptPayload: undefined, disputeCustomId: undefined, approvedBy: undefined });
  const draft = await agents.draftDisputeResponse(input);
  assert.equal(draft.hashSource, "NO_RECEIPT");
  assert.equal(draft.recommendation, "ACCEPT");
});

test("a verified hash without a recorded owner approval is not enough to contest", async () => {
  const { agents } = await m();
  const { input } = await agentInput({ approvedBy: undefined });
  assert.equal((await agents.draftDisputeResponse(input)).recommendation, "ACCEPT");
});

test("every evidence tool runs and is traced, labelled as fallback when the model did not run it", async () => {
  const { agents } = await m();
  const { input } = await agentInput();
  const draft = await agents.draftDisputeResponse(input);
  const tools = draft.toolCalls.map((t) => t.tool);
  for (const t of ["get_dispute", "get_receipt", "get_event_timeline", "get_paypal_confirmation", "verify_hash"]) assert.ok(tools.includes(t), `${t} ran`);
  assert.ok(draft.toolCalls.every((t) => t.source === "FALLBACK"));
});

test("the merchant's reply comes first and the PayPal notes stay within PayPal's limit", async () => {
  const { agents } = await m();
  const timeline = Array.from({ length: 14 }, (_, i) => ({ at: `2026-11-09T12:${String(i).padStart(2, "0")}:00Z`, actor: "PayPal", event: "x".repeat(120), detail: "y".repeat(80) }));
  const { input } = await agentInput({ timeline });
  const draft = await agents.draftDisputeResponse(input);
  assert.ok(draft.draft.startsWith("Merchant response:"));
  const notes = draft.payload.evidences[0].notes as string;
  assert.ok(notes.length <= agents.EVIDENCE_NOTES_LIMIT, `notes are ${notes.length} chars`);
  assert.ok(notes.startsWith("Merchant response:"), "trimming can only cut the supporting facts");
});

test("the evidence never claims the receipt proves who approved or that the payment was authorized", async () => {
  const { agents } = await m();
  const { input } = await agentInput();
  const draft = await agents.draftDisputeResponse(input);
  assert.doesNotMatch(draft.draft, /\bproves?\b|can be proven|proven that/i);
  assert.match(draft.draft, /has not been (altered|changed)/);
});

// ---------------------------------------------------------------------------
// Submitting evidence: the one irreversible call
// ---------------------------------------------------------------------------

async function seedCase(over: Record<string, unknown> = {}, order: Record<string, unknown> = {}) {
  const { store, receipts } = await m();
  const hash = receipts.hashReceipt(receipt);
  net.orders.set("ORD-1", {
    id: "ORD-1", status: "COMPLETED",
    purchase_units: [{ amount: { currency_code: "USD", value: "48.00" }, custom_id: hash, payments: { captures: [{ id: "CAP-ORD-1", status: "COMPLETED" }] } }],
  });
  const now = new Date().toISOString();
  await store.mutate((db) => {
    const fresh = store.emptyDB();
    for (const k of Object.keys(fresh)) (db as any)[k] = (fresh as any)[k];
    db.intents.push({ id: "i1", product: "Oat milk case (12)", quantity: 2, amount: "48.00", currency: "USD", rationale: "", alternatives: [], status: "CAPTURED", receiptHash: hash, receiptPayload: receipt, approvedBy: "cafe-owner", approvedAt: receipt.approvedAt, createdAt: now } as any);
    db.orders.push({ id: "o1", intentId: "i1", paypalOrderId: "ORD-1", captureId: "CAP-ORD-1", status: "COMPLETED", customId: hash, amount: "48.00", currency: "USD", createdAt: now, capturedAt: now, ...order } as any);
    db.disputes.push({
      id: "d1", paypalDisputeId: "PP-D-1", orderId: "o1", captureId: "CAP-ORD-1", reason: "UNAUTHORISED", status: "WAITING_FOR_SELLER_RESPONSE", agentRecommendation: "CONTEST",
      hashVerified: true, hashSource: "PAYPAL_CAPTURE_CUSTOM_ID", merchantApproved: true, submitted: false, agentDraft: "Merchant response: The approval record existed at payment time.",
      agentPayload: { evidences: [{ evidence_type: "OTHER", notes: "Merchant response: ok" }] }, createdAt: now, ...over,
    } as any);
  });
}

const submitCase = async () => call((await m()).submit, { id: "d1" });
const dispute = async () => (await (await m()).store.loadDB()).disputes[0];

beforeEach(() => net.reset());

test("submitting sends the response and the PDF to PayPal exactly once", async () => {
  await seedCase();
  const res = await submitCase();
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(net.evidenceSubmissions.length, 1);
  assert.equal(net.evidenceSubmissions[0].file, true, "the evidence PDF is attached");
  assert.equal(net.evidenceSubmissions[0].input.evidences[0].evidence_type, "OTHER");
  const d = await dispute();
  assert.equal(d.submitted, true);
  assert.equal(d.status, "EVIDENCE_SUBMITTED");
  assert.ok((await (await m()).store.loadDB()).ledger.some((l) => l.eventType === "EVIDENCE_SUBMITTED"));
});

test("a second submit is refused and sends nothing more", async () => {
  await seedCase();
  await submitCase();
  const again = await submitCase();
  assert.equal(again.status, 409);
  assert.match(again.json.error, /already submitted/);
  assert.equal(net.evidenceSubmissions.length, 1);
});

test("refuses to submit a response the supplier has not approved", async () => {
  await seedCase({ merchantApproved: false });
  const res = await submitCase();
  assert.equal(res.status, 400);
  assert.match(res.json.error, /Approve the response first/);
  assert.equal(net.calls.length, 0);
});

test("refuses to contest when the agent recommended a refund", async () => {
  await seedCase({ agentRecommendation: "ACCEPT" });
  assert.equal((await submitCase()).status, 400);
  assert.equal(net.evidenceSubmissions.length, 0);
});

test("refuses to contest when the hash was not verified against PayPal's own record", async () => {
  await seedCase({ hashVerified: false, hashSource: "STORED_RECEIPT" });
  const res = await submitCase();
  assert.equal(res.status, 400);
  assert.match(res.json.error, /not verified against PayPal/);
  assert.equal(net.evidenceSubmissions.length, 0);
});

test("a sample dispute is never sent to PayPal", async () => {
  await seedCase({ simulator: true, paypalDisputeId: "simulated" });
  const res = await submitCase();
  assert.equal(res.status, 400);
  assert.match(res.json.error, /never sent/);
  assert.equal(net.calls.length, 0);
});

test("re-verifies against PayPal immediately before sending, and a changed record blocks it (then a retry works)", async () => {
  await seedCase();
  net.cfg.captureCustomId = "d".repeat(64); // PayPal's copy no longer matches
  const blocked = await submitCase();
  assert.equal(blocked.status, 409);
  assert.match(blocked.json.error, /no longer contain this receipt hash/);
  assert.equal(net.evidenceSubmissions.length, 0);
  assert.equal((await dispute() as any).submittingAt, undefined, "the in-flight lock is released after a failure");

  net.cfg.captureCustomId = undefined;
  assert.equal((await submitCase()).status, 200);
  assert.equal(net.evidenceSubmissions.length, 1);
});

test("refuses when PayPal says the dispute is already closed", async () => {
  await seedCase();
  net.cfg.disputeStatus = "RESOLVED";
  const res = await submitCase();
  assert.equal(res.status, 409);
  assert.match(res.json.error, /evidence can no longer be submitted/);
  assert.equal(net.evidenceSubmissions.length, 0);
});

test("refuses when the dispute is about a different capture than the receipt was paid with", async () => {
  await seedCase({}, { captureId: "CAP-SOMETHING-ELSE" });
  const res = await submitCase();
  assert.equal(res.status, 409);
  assert.match(res.json.error, /not CAP-SOMETHING-ELSE/);
  assert.equal(net.evidenceSubmissions.length, 0);
});

test("a submission already in flight blocks a double click", async () => {
  await seedCase({ submittingAt: Date.now() });
  const res = await submitCase();
  assert.equal(res.status, 409);
  assert.match(res.json.error, /already being sent/);
  assert.equal(net.evidenceSubmissions.length, 0);
});

test("refuses to submit when the stored receipt no longer matches its hash", async () => {
  await seedCase();
  const { store } = await m();
  await store.mutate((db) => {
    db.intents[0].receiptPayload.amount = "1.00";
  });
  const res = await submitCase();
  assert.equal(res.status, 409);
  assert.match(res.json.error, /no longer matches its hash/);
  assert.equal(net.evidenceSubmissions.length, 0);
});
