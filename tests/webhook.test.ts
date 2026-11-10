import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { setupEnv, installFakeNetwork, call } from "./helpers.ts";

setupEnv();
const net = installFakeNetwork();
after(() => net.restore());

let loaded: Awaited<ReturnType<typeof loadAll>> | undefined;
async function loadAll() {
  return { store: await import("@/lib/store"), webhook: (await import("@/app/api/webhooks/paypal/route")).POST };
}
const m = () => (loaded ??= loadAll());

const HASH = "a".repeat(64);
const SIGNED = { "paypal-transmission-id": "tx-1", "paypal-transmission-time": "2026-11-09T12:00:00Z", "paypal-transmission-sig": "sig", "paypal-cert-url": "https://api.paypal.com/cert", "paypal-auth-algo": "SHA256withRSA" };

/** An approved order that is waiting for its capture confirmation. */
async function pendingOrder() {
  const { store } = await m();
  await store.mutate((db) => {
    const fresh = store.emptyDB();
    for (const k of Object.keys(fresh)) (db as any)[k] = (fresh as any)[k];
    db.intents.push({ id: "i1", product: "Oat milk case (12)", quantity: 2, amount: "48.00", currency: "USD", rationale: "", alternatives: [], status: "APPROVED", receiptHash: HASH, createdAt: new Date().toISOString() } as any);
    db.orders.push({ id: "o1", intentId: "i1", paypalOrderId: "PP-ORDER-1", status: "APPROVED", customId: HASH, amount: "48.00", currency: "USD", createdAt: new Date().toISOString() } as any);
  });
}

const capture = (over: Record<string, unknown> = {}) => ({
  id: "evt-1",
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  resource: { id: "CAP-1", amount: { value: "48.00", currency_code: "USD" }, custom_id: HASH, supplementary_data: { related_ids: { order_id: "PP-ORDER-1" } }, ...over },
});

const send = async (event: unknown, headers: Record<string, string> = SIGNED) => call((await m()).webhook, { raw: JSON.stringify(event), headers });
const ledgerTypes = async () => (await (await m()).store.loadDB()).ledger.map((l) => l.eventType);

beforeEach(async () => {
  net.reset();
  process.env.PAYPAL_WEBHOOK_ID = "WH-TEST";
  process.env.ALLOW_SIMULATOR = "false";
  await pendingOrder();
});

test("a signed capture event marks the order paid, once, and PayPal is asked to verify the exact headers", async () => {
  const { store } = await m();
  const res = await send(capture());
  assert.equal(res.status, 200);
  assert.equal(res.json.source, "REAL");

  const verifyCall = net.calls.find((c) => c.path === "/v1/notifications/verify-webhook-signature")!;
  assert.equal(verifyCall.body.webhook_id, "WH-TEST");
  assert.equal(verifyCall.body.transmission_id, "tx-1");
  assert.equal(verifyCall.body.transmission_sig, "sig");
  assert.equal(verifyCall.body.cert_url, "https://api.paypal.com/cert");

  const db = await store.loadDB();
  assert.equal(db.orders[0].status, "COMPLETED");
  assert.equal(db.orders[0].captureId, "CAP-1");
  assert.equal(db.intents[0].status, "CAPTURED");
  assert.equal(db.inventory["Oat milk case (12)"], 6 + 2);
  assert.ok((await ledgerTypes()).includes("CAPTURE_COMPLETED"));
});

test("an event PayPal does not vouch for is rejected and changes nothing", async () => {
  const { store } = await m();
  net.cfg.webhookValid = false;
  const res = await send(capture());
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "webhook rejected");
  const db = await store.loadDB();
  assert.equal(db.orders[0].status, "APPROVED");
  assert.equal(db.events.length, 0);
});

test("without PAYPAL_WEBHOOK_ID a real event cannot be verified, so it is rejected", async () => {
  process.env.PAYPAL_WEBHOOK_ID = "";
  const res = await send(capture());
  assert.equal(res.status, 400);
  assert.match(res.json.reason, /PAYPAL_WEBHOOK_ID is not configured/);
  assert.equal(net.calls.length, 0);
});

test("unsigned simulator events are refused unless ALLOW_SIMULATOR is true", async () => {
  const { store } = await m();
  const res = await send(capture(), { "x-simulator": "true" });
  assert.equal(res.status, 403);
  assert.equal((await store.loadDB()).orders[0].status, "APPROVED");
  assert.equal(net.calls.length, 0, "PayPal is not even contacted");
});

test("even when enabled, a simulator event never changes a real order", async () => {
  const { store } = await m();
  process.env.ALLOW_SIMULATOR = "true";
  const res = await send(capture(), { "x-simulator": "true" });
  assert.equal(res.status, 200);
  assert.equal(res.json.source, "SIMULATOR");
  assert.equal((await store.loadDB()).orders[0].status, "APPROVED");
  assert.ok((await ledgerTypes()).includes("SIMULATOR_EVENT_IGNORED"));
});

test("a capture whose amount differs from the receipt is flagged and not marked paid", async () => {
  const { store } = await m();
  await send(capture({ amount: { value: "480.00", currency_code: "USD" } }));
  const db = await store.loadDB();
  assert.equal(db.orders[0].status, "APPROVED");
  assert.ok((await ledgerTypes()).includes("CAPTURE_MISMATCH"));
});

test("a capture carrying a different custom_id is flagged and not marked paid", async () => {
  const { store } = await m();
  await send(capture({ custom_id: "b".repeat(64) }));
  assert.equal((await store.loadDB()).orders[0].status, "APPROVED");
  assert.ok((await ledgerTypes()).includes("CAPTURE_MISMATCH"));
});

test("a capture that matches no RelayPay payment is recorded as an orphan", async () => {
  const { store } = await m();
  await send({ id: "evt-9", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAP-X", amount: { value: "5.00", currency_code: "USD" } } });
  assert.equal((await store.loadDB()).orders[0].status, "APPROVED");
  assert.ok((await ledgerTypes()).includes("CAPTURE_ORPHAN"));
});

test("PayPal retrying the same event does not apply it twice", async () => {
  const { store } = await m();
  await send(capture());
  const again = await send(capture());
  assert.equal(again.json.duplicate, true);
  assert.equal((await store.loadDB()).inventory["Oat milk case (12)"], 8, "stock is not added twice");
});

test("a dispute update changes the stored case, and a buyer-favour resolution is recorded as accepted", async () => {
  const { store } = await m();
  await store.mutate((db) => {
    db.disputes.push({ id: "d1", paypalDisputeId: "PP-D-1", reason: "UNAUTHORISED", status: "OPEN", merchantApproved: false, submitted: false, createdAt: new Date().toISOString() } as any);
  });
  await send({ id: "evt-d1", event_type: "CUSTOMER.DISPUTE.UPDATED", resource: { dispute_id: "PP-D-1", status: "UNDER_REVIEW" } });
  assert.equal((await store.loadDB()).disputes[0].status, "UNDER_REVIEW");
  await send({ id: "evt-d2", event_type: "CUSTOMER.DISPUTE.RESOLVED", resource: { dispute_id: "PP-D-1", status: "RESOLVED", dispute_outcome: { outcome_code: "RESOLVED_BUYER_FAVOUR" } } });
  assert.equal((await store.loadDB()).disputes[0].resolution, "ACCEPTED");
});

test("malformed and oversized bodies are rejected before anything is verified", async () => {
  const bad = await call((await m()).webhook, { raw: "{not json", headers: SIGNED });
  assert.equal(bad.status, 400);
  const huge = await call((await m()).webhook, { raw: JSON.stringify({ pad: "x".repeat(1_000_001) }), headers: SIGNED });
  assert.equal(huge.status, 413);
  assert.equal(net.calls.length, 0);
});
