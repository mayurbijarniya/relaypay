import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { setupEnv, installFakeNetwork, call } from "./helpers.ts";

setupEnv({ DAILY_CAP_USD: "500" });
const net = installFakeNetwork();
after(() => net.restore());

let loaded: Awaited<ReturnType<typeof loadAll>> | undefined;
async function loadAll() {
  return {
    store: await import("@/lib/store"),
    receipts: await import("@/lib/receipts"),
    approve: (await import("@/app/api/intents/[id]/approve/route")).POST,
    create: (await import("@/app/api/orders/create/route")).POST,
    verify: (await import("@/app/api/orders/[id]/verify/route")).GET,
  };
}
const m = () => (loaded ??= loadAll());

async function resetDb() {
  const { store } = await m();
  await store.mutate((db) => {
    const fresh = store.emptyDB();
    for (const k of Object.keys(fresh)) (db as any)[k] = (fresh as any)[k];
  });
}

/** An agent proposal waiting for the owner. $24 x 2 = $48, under the high-value limit. */
async function proposal(over: Record<string, unknown> = {}) {
  const { store } = await m();
  const id = crypto.randomUUID();
  await store.mutate((db) => {
    db.intents.push({
      id, product: "Oat milk case (12)", quantity: 2, amount: "48.00", currency: "USD", rationale: "Stock is low.", alternatives: [],
      status: "PROPOSED", agentId: "relaypay-cafe-agent-1", model: "test-model", promptHash: "abc", createdAt: new Date().toISOString(), ...over,
    } as any);
  });
  return id;
}

async function approved(over: Record<string, unknown> = {}) {
  const { approve } = await m();
  const id = await proposal(over);
  const res = await call(approve, { id, body: { approvedBy: "cafe-owner" } });
  assert.equal(res.status, 200, `approval failed: ${JSON.stringify(res.json)}`);
  return id;
}

async function connectVault() {
  const { store } = await m();
  await store.mutate((db) => {
    db.vault.vaultId = "VAULT-1";
    db.vault.status = "ACTIVE";
  });
}

const intentOf = async (id: string) => (await (await m()).store.loadDB()).intents.find((i) => i.id === id)!;

beforeEach(async () => {
  net.reset();
  await resetDb();
});

test("approval seals a receipt whose SHA-256 hash is stored with the intent", async () => {
  const { receipts } = await m();
  const id = await approved();
  const intent = await intentOf(id);
  assert.equal(intent.status, "APPROVED");
  assert.match(intent.receiptHash!, /^[a-f0-9]{64}$/);
  assert.equal(receipts.hashReceipt(intent.receiptPayload), intent.receiptHash);
});

test("charging: custom_id is the receipt hash, the amount is the catalog price, and the order is captured once", async () => {
  const { create, store } = await m();
  await connectVault();
  const id = await approved();
  const intent = await intentOf(id);

  const res = await call(create, { body: { intentId: id } });
  assert.equal(res.status, 200);
  assert.equal(res.json.captured, true);

  const [createCall] = net.created();
  assert.equal(createCall.headers["paypal-request-id"], `relaypay-${id}`, "order creation is idempotent per proposal");
  const unit = createCall.body.purchase_units[0];
  assert.equal(unit.custom_id, intent.receiptHash);
  assert.deepEqual(unit.amount, { currency_code: "USD", value: "48.00" });
  assert.equal(createCall.body.payment_source.paypal.vault_id, "VAULT-1");

  assert.equal(net.captured().length, 1, "an APPROVED order is captured explicitly");
  assert.equal(net.captured()[0].headers["paypal-request-id"], `relaypay-capture-${res.json.order.paypalOrderId}`);

  const db = await store.loadDB();
  assert.equal(db.intents.find((i) => i.id === id)!.status, "CAPTURED");
  assert.equal(db.orders[0].status, "COMPLETED");
  assert.equal(db.inventory["Oat milk case (12)"], 6 + 2, "stock is received exactly once");
});

test("a second request for the same proposal does not charge again", async () => {
  const { create, store } = await m();
  await connectVault();
  const id = await approved();
  await call(create, { body: { intentId: id } });
  const again = await call(create, { body: { intentId: id } });

  assert.equal(again.status, 200);
  assert.equal(again.json.duplicate, true);
  assert.equal(net.created().length, 1);
  assert.equal(net.captured().length, 1);
  assert.equal((await store.loadDB()).inventory["Oat milk case (12)"], 8);
});

test("refuses to charge a proposal that was never approved", async () => {
  const { create } = await m();
  await connectVault();
  const id = await proposal();
  const res = await call(create, { body: { intentId: id } });
  assert.equal(res.status, 409);
  assert.match(res.json.error, /Approve the receipt before paying/);
  assert.equal(net.created().length, 0);
});

test("charges a receipt whose nested keys were reordered by Postgres JSONB", async () => {
  const { create, store, receipts } = await m();
  await connectVault();
  const marketCheck = { source: "channel3", query: "Oat milk", offerCount: 3, medianPrice: "20.00", lowestPrice: "18.00", catalogPrice: "24.00", verdict: "ABOVE_MARKET", checkedAt: "2026-11-10T00:00:00.000Z" };
  const id = await approved({ marketCheck });
  // JSONB keeps keys sorted by length, then alphabetically; mimic that on the stored copy.
  const jsonbOrder = (o: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.length - b.length || (a < b ? -1 : 1)));
  await store.mutate((db) => {
    const payload = db.intents.find((i) => i.id === id)!.receiptPayload;
    payload.policyChecks = jsonbOrder(payload.policyChecks);
    payload.marketCheck = jsonbOrder(payload.marketCheck);
  });
  const intent = await intentOf(id);
  assert.notEqual(JSON.stringify(Object.keys(intent.receiptPayload.policyChecks)), JSON.stringify(Object.keys(intent.policyChecks!)), "the stored key order really differs");
  assert.equal(receipts.hashReceipt(intent.receiptPayload), intent.receiptHash);
  const res = await call(create, { body: { intentId: id } });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.captured, true);
});

test("refuses to charge when the sealed receipt was altered after approval", async () => {
  const { create, store } = await m();
  await connectVault();
  const id = await approved();
  await store.mutate((db) => {
    db.intents.find((i) => i.id === id)!.receiptPayload.amount = "1.00";
  });
  const res = await call(create, { body: { intentId: id } });
  assert.equal(res.status, 409);
  assert.match(res.json.error, /changed after approval/);
  assert.equal(net.calls.length, 0, "PayPal is never contacted");
});

test("refuses when the quantity no longer matches the approved amount (catalog price x quantity)", async () => {
  const { create, store } = await m();
  await connectVault();
  const id = await approved();
  await store.mutate((db) => {
    db.intents.find((i) => i.id === id)!.quantity = 3;
  });
  const res = await call(create, { body: { intentId: id } });
  assert.equal(res.status, 409);
  assert.match(res.json.error, /doesn't match the catalog/);
  assert.equal(net.created().length, 0);
});

test("enforces the daily cap again at payment time", async () => {
  const { create, store } = await m();
  await connectVault();
  const id = await approved(); // passes the cap check at approval: nothing spent yet
  const now = new Date().toISOString();
  await store.mutate((db) => {
    db.orders.push({ id: "o-earlier", intentId: "other", paypalOrderId: "PP-1", status: "COMPLETED", customId: "c", amount: "480.00", currency: "USD", createdAt: now, capturedAt: now });
  });
  const res = await call(create, { body: { intentId: id } });
  assert.equal(res.status, 409);
  assert.match(res.json.error, /Over today's cap/);
  assert.equal(net.created().length, 0);
});

test("requires the café's saved PayPal (Vault) before charging", async () => {
  const { create } = await m();
  const id = await approved();
  const res = await call(create, { body: { intentId: id } });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /Connect PayPal Vault/);
});

test("refuses to capture a PayPal order that carries a different custom_id", async () => {
  const { create } = await m();
  await connectVault();
  net.cfg.tamperCustomId = true;
  const id = await approved();
  const res = await call(create, { body: { intentId: id } });
  assert.equal(res.status, 409);
  assert.match(res.json.error, /different custom_id/);
  assert.equal(net.captured().length, 0, "nothing is captured");
});

test("refuses to capture a PayPal order whose amount differs from the approved amount", async () => {
  const { create } = await m();
  await connectVault();
  net.cfg.tamperAmount = true;
  const id = await approved();
  const res = await call(create, { body: { intentId: id } });
  assert.equal(res.status, 409);
  assert.match(res.json.error, /doesn't match the approved amount/);
  assert.equal(net.captured().length, 0);
});

test("a capture that succeeded at PayPal but errored in transit is recovered by re-reading the order", async () => {
  const { create } = await m();
  await connectVault();
  net.cfg.captureThrows = true;
  const id = await approved();
  const res = await call(create, { body: { intentId: id } });
  assert.equal(res.status, 200);
  assert.equal(res.json.captured, true);
});

test("a PENDING capture is not reported as paid and adds no stock", async () => {
  const { create, store } = await m();
  await connectVault();
  net.cfg.captureStatus = "PENDING";
  const id = await approved();
  const res = await call(create, { body: { intentId: id } });
  assert.equal(res.status, 202);
  assert.equal(res.json.captured, false);
  const db = await store.loadDB();
  assert.equal(db.intents.find((i) => i.id === id)!.status, "APPROVED", "stays approved until the capture completes");
  assert.equal(db.inventory["Oat milk case (12)"], 6);
});

test("verify re-reads PayPal and passes only when the custom_id, amount and capture all agree", async () => {
  const { create, verify } = await m();
  await connectVault();
  const id = await approved();
  const charged = await call(create, { body: { intentId: id } });
  const orderId = charged.json.order.id;

  const ok = await call(verify, { method: "GET", id: orderId });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.verified, true);
  assert.equal(ok.json.customIdMatches, true);

  // PayPal's copy changes: the check must fail.
  net.orders.get(charged.json.order.paypalOrderId).purchase_units[0].custom_id = "0".repeat(64);
  const bad = await call(verify, { method: "GET", id: orderId });
  assert.equal(bad.json.verified, false);
  assert.equal(bad.json.customIdMatches, false);
});

// ---------------------------------------------------------------------------
// Approval: the moment the receipt is sealed
// ---------------------------------------------------------------------------

test("an order over the high-value limit needs the owner's explicit confirmation", async () => {
  const { approve } = await m();
  const id = await proposal({ quantity: 5, amount: "120.00" }); // 5 x $24 = $120, over the $100 limit
  const refused = await call(approve, { id, body: { approvedBy: "cafe-owner" } });
  assert.equal(refused.status, 428);
  assert.equal(refused.json.requiresHighValueConfirmation, true);
  assert.equal((await intentOf(id)).status, "PROPOSED", "nothing is sealed without the confirmation");

  const ok = await call(approve, { id, body: { approvedBy: "cafe-owner", confirmHighValue: true } });
  assert.equal(ok.status, 200);
  assert.equal((await intentOf(id)).receiptPayload.highValueConfirmed, true, "the confirmation is sealed into the receipt");
});

test("approval recomputes the price: an amount that disagrees with the catalog is refused", async () => {
  const { approve } = await m();
  const id = await proposal({ amount: "1.00" });
  const res = await call(approve, { id, body: { approvedBy: "cafe-owner" } });
  assert.equal(res.status, 409);
  assert.match(res.json.error, /doesn't match/);
  assert.equal((await intentOf(id)).status, "PROPOSED");
});

test("approval refuses a product that is not in the catalog", async () => {
  const { approve } = await m();
  const id = await proposal({ product: "Espresso machine", amount: "999.00" });
  const res = await call(approve, { id, body: { approvedBy: "cafe-owner" } });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /Unknown product/);
});

test("approval refuses a quantity above the maximum", async () => {
  const { approve } = await m();
  const id = await proposal({ quantity: 25, amount: "600.00" });
  const res = await call(approve, { id, body: { approvedBy: "cafe-owner", confirmHighValue: true } });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /Quantity must be between/);
});

test("approval refuses an order that would exceed today's cap", async () => {
  const { approve, store } = await m();
  const now = new Date().toISOString();
  await store.mutate((db) => {
    db.orders.push({ id: "o-earlier", intentId: "other", paypalOrderId: "PP-1", status: "COMPLETED", customId: "c", amount: "480.00", currency: "USD", createdAt: now, capturedAt: now });
  });
  const id = await proposal();
  const res = await call(approve, { id, body: { approvedBy: "cafe-owner" } });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /Over today's cap/);
});

test("a proposal can only be approved once", async () => {
  const { approve } = await m();
  const id = await approved();
  const again = await call(approve, { id, body: { approvedBy: "cafe-owner" } });
  assert.equal(again.status, 409);
  assert.match(again.json.error, /already approved/);
});
