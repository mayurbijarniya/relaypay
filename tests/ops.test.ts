import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { setupEnv, installFakeNetwork, call } from "./helpers.ts";

setupEnv({ DISABLE_RATE_LIMITS: "false", PAYPAL_TIMEOUT_MS: "60", DAILY_CAP_USD: "1500" });
const net = installFakeNetwork();
after(() => net.restore());

let loaded: Awaited<ReturnType<typeof loadAll>> | undefined;
async function loadAll() {
  return {
    store: await import("@/lib/store"),
    rate: await import("@/lib/rateLimit"),
    policy: await import("@/lib/policy"),
    client: await import("@/lib/paypal/client"),
    health: (await import("@/app/api/health/route")).GET,
    webhook: (await import("@/app/api/webhooks/paypal/route")).POST,
    reset: (await import("@/app/api/admin/reset/route")).POST,
  };
}
const m = () => (loaded ??= loadAll());

beforeEach(() => {
  net.reset();
  delete process.env.RATE_LIMIT_MULTIPLIER;
  process.env.DISABLE_RATE_LIMITS = "false";
});

// --- rate limits -----------------------------------------------------------

test("a visitor is limited to the per-window count, then told how long to wait", async () => {
  const { store, rate } = await m();
  const db = store.emptyDB();
  const perWindow = rate.LIMITS.capture.perWindow;
  for (let i = 0; i < perWindow; i++) assert.equal(rate.checkRateLimit(db, "capture", "1.1.1.1").ok, true);
  const blocked = rate.checkRateLimit(db, "capture", "1.1.1.1");
  assert.equal(blocked.ok, false);
  assert.match((blocked as any).reason, /Too many requests\. Please wait about \d+ minutes?/);
});

test("one visitor's limit does not affect another's", async () => {
  const { store, rate } = await m();
  const db = store.emptyDB();
  for (let i = 0; i < rate.LIMITS.capture.perWindow; i++) rate.checkRateLimit(db, "capture", "1.1.1.1");
  assert.equal(rate.checkRateLimit(db, "capture", "2.2.2.2").ok, true);
});

test("the window resets after it elapses", async () => {
  const { store, rate } = await m();
  const db = store.emptyDB();
  for (let i = 0; i < rate.LIMITS.capture.perWindow; i++) rate.checkRateLimit(db, "capture", "1.1.1.1");
  assert.equal(rate.checkRateLimit(db, "capture", "1.1.1.1").ok, false);
  for (const row of db.rateLimits) row.windowStart = Date.now() - rate.LIMITS.capture.windowMs - 1000;
  assert.equal(rate.checkRateLimit(db, "capture", "1.1.1.1").ok, true);
});

test("the daily limit is shared by every visitor", async () => {
  const { store, rate } = await m();
  const db = store.emptyDB();
  const today = new Date().toISOString().slice(0, 10);
  db.rateLimits.push({ key: `capture:9.9.9.9:${today}`, count: rate.LIMITS.capture.perDay, day: today, lastAt: Date.now() });
  const blocked = rate.checkRateLimit(db, "capture", "3.3.3.3");
  assert.equal(blocked.ok, false);
  assert.match((blocked as any).reason, /reached today's limit/);
});

test("RATE_LIMIT_MULTIPLIER gives a shared demo more headroom", async () => {
  const { store, rate } = await m();
  process.env.RATE_LIMIT_MULTIPLIER = "2";
  const db = store.emptyDB();
  const doubled = rate.LIMITS.capture.perWindow * 2;
  for (let i = 0; i < doubled; i++) assert.equal(rate.checkRateLimit(db, "capture", "1.1.1.1").ok, true, `request ${i + 1}`);
  assert.equal(rate.checkRateLimit(db, "capture", "1.1.1.1").ok, false);
});

test("a nonsense multiplier is ignored, never zero or negative", async () => {
  const { store, rate } = await m();
  for (const bad of ["0", "-3", "abc", ""]) {
    process.env.RATE_LIMIT_MULTIPLIER = bad;
    const db = store.emptyDB();
    assert.equal(rate.checkRateLimit(db, "capture", "1.1.1.1").ok, true, `"${bad}" must not lock everyone out`);
    for (let i = 1; i < rate.LIMITS.capture.perWindow; i++) rate.checkRateLimit(db, "capture", "1.1.1.1");
    assert.equal(rate.checkRateLimit(db, "capture", "1.1.1.1").ok, false, `"${bad}" falls back to the default limit`);
  }
});

test("DISABLE_RATE_LIMITS turns the limits off", async () => {
  const { store, rate } = await m();
  process.env.DISABLE_RATE_LIMITS = "true";
  const db = store.emptyDB();
  for (let i = 0; i < 500; i++) assert.equal(rate.checkRateLimit(db, "capture", "1.1.1.1").ok, true);
});

// --- daily cap config ------------------------------------------------------

test("DAILY_CAP_USD raises the cap and the policy reports it", async () => {
  const { policy } = await m();
  assert.equal(policy.DAILY_CAP_USD, 1500);
  const checks = policy.evaluatePolicy({ unitPriceCents: 4200, quantity: 20, spentTodayCents: 0 });
  assert.equal(checks.dailyCap, "1500.00");
  assert.equal(checks.withinDailyCap, true, "$840 fits under $1,500");
});

test("a missing or invalid DAILY_CAP_USD falls back to 500", () => {
  const policyPath = path.resolve(__dirname, "..", "lib", "policy.ts");
  const read = (value: string | undefined) => {
    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    if (value === undefined) delete env.DAILY_CAP_USD;
    else env.DAILY_CAP_USD = value;
    return execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "-e", `import(${JSON.stringify(policyPath)}).then((m) => console.log(m.DAILY_CAP_USD ?? m.default.DAILY_CAP_USD))`], {
      env, cwd: path.resolve(__dirname, ".."), encoding: "utf8",
    }).trim();
  };
  assert.equal(read(undefined), "500");
  assert.equal(read("abc"), "500");
  assert.equal(read("0"), "500");
  assert.equal(read("-20"), "500");
  assert.equal(read("750.9"), "750");
});

// --- health ----------------------------------------------------------------

test("the health endpoint is cheap by default and can check the database on request", async () => {
  const { health } = await m();
  const shallow = await call(health, { method: "GET" });
  assert.equal(shallow.status, 200);
  assert.deepEqual(shallow.json, { ok: true, storage: "file" });

  const deepReq = new Request("http://localhost/api/health?deep=1");
  const res = await health(deepReq, { params: Promise.resolve({}) });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).database, "ok");
});

// --- timeouts --------------------------------------------------------------

test("a hung PayPal call fails fast with a readable 504 instead of hanging", { timeout: 5000 }, async () => {
  const { client } = await m();
  net.cfg.hang = true;
  const started = Date.now();
  await assert.rejects(
    () => client.paypalFetch("/v2/checkout/orders/ORD-1"),
    (e: any) => e.name === "PayPalApiError" && e.status === 504 && /timed out/.test(e.message),
  );
  assert.ok(Date.now() - started < 3000, "it gave up quickly");
});

test("a webhook whose verification call hangs is rejected, not left waiting", { timeout: 5000 }, async () => {
  const { webhook } = await m();
  net.cfg.hang = true;
  const res = await call(webhook, { raw: JSON.stringify({ id: "evt-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} }), headers: { "paypal-transmission-id": "t" } });
  assert.equal(res.status, 400);
  assert.match(res.json.reason, /timed out/);
});

// --- demo reset ------------------------------------------------------------

async function seedState() {
  const { store } = await m();
  await store.mutate((db) => {
    db.intents.push({ id: "i1", product: "Oat milk case (12)", quantity: 1, amount: "24.00", currency: "USD", rationale: "", alternatives: [], status: "CAPTURED", createdAt: new Date().toISOString() } as any);
    db.orders.push({ id: "o1", intentId: "i1", paypalOrderId: "ORD-1", status: "COMPLETED", customId: "x", amount: "24.00", currency: "USD", createdAt: new Date().toISOString() });
    db.vault = { vaultId: "VAULT-1", status: "ACTIVE" };
    db.inventory["Sugar 10lb bag"] = 99;
  });
}

test("reset is turned off unless ADMIN_RESET_TOKEN is set (and long enough)", async () => {
  const { reset } = await m();
  delete process.env.ADMIN_RESET_TOKEN;
  assert.equal((await call(reset, { body: { token: "anything-at-all" } })).status, 404);
  process.env.ADMIN_RESET_TOKEN = "short";
  assert.equal((await call(reset, { body: { token: "short" } })).status, 404);
});

test("reset refuses a missing or wrong code and changes nothing", async () => {
  const { reset, store } = await m();
  process.env.ADMIN_RESET_TOKEN = "correct-horse-battery";
  await seedState();
  for (const body of [{}, { token: "" }, { token: "wrong-code-entirely" }, { token: 12345 }]) {
    assert.equal((await call(reset, { body })).status, 403);
  }
  const db = await store.loadDB();
  assert.equal(db.orders.length, 1);
  assert.equal(db.inventory["Sugar 10lb bag"], 99);
});

test("reset clears the demo, restores stock, and keeps the saved Vault", async () => {
  const { reset, store, policy } = await m();
  process.env.ADMIN_RESET_TOKEN = "correct-horse-battery";
  await seedState();
  const res = await call(reset, { body: { token: "correct-horse-battery" } });
  assert.equal(res.status, 200);
  const db = await store.loadDB();
  assert.equal(db.intents.length, 0);
  assert.equal(db.orders.length, 0);
  assert.equal(db.disputes.length, 0);
  assert.equal(db.vault.vaultId, "VAULT-1");
  assert.deepEqual(db.inventory, policy.initialInventory());
  assert.deepEqual(db.ledger.map((l) => l.eventType), ["DEMO_RESET"]);
  delete process.env.ADMIN_RESET_TOKEN;
});
