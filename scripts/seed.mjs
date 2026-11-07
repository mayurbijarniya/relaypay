#!/usr/bin/env node
/**
 * Create spare captured payments through the running app, so the one-shot
 * sandbox dispute for the demo video has backups.
 *
 *   npm run dev            # in another terminal
 *   npm run seed           # or: BASE_URL=https://your-app.onrender.com npm run seed
 *   npm run seed -- 2      # how many (default 3)
 *
 * Needs PayPal Vault connected (Settings). Uses only the public API, exactly
 * like the UI, so every policy check and rate limit still applies.
 */
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const COUNT = Math.max(1, Math.min(5, Number(process.argv[2]) || 3));
const TASKS = [
  "Order 2 bags of sugar",
  "Order one 5lb bag of coffee beans",
  "Order 2 cases of oat milk",
  "Order one 40lb bag of coffee beans",
  "Order 3 bags of sugar",
];

async function call(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`${path}: ${json.error || res.status}`);
  return json;
}

const state = await call("/api/ledger").catch((e) => {
  console.error(`Can't reach RelayPay at ${BASE}. Start it with "npm run dev" first.\n${e.message}`);
  process.exit(1);
});
if (!state.vault?.active) {
  console.error("PayPal Vault isn't connected. Open Settings in RelayPay and connect it first.");
  process.exit(1);
}

console.log(`Seeding ${COUNT} captured payment(s) at ${BASE}\n`);
for (const task of TASKS.slice(0, COUNT)) {
  try {
    const { intent } = await call("/api/intents/propose", { task });
    await call(`/api/intents/${intent.id}/approve`, { approvedBy: "cafe-owner", confirmHighValue: true });
    const paid = await call("/api/orders/create", { intentId: intent.id });
    console.log(`✓ ${intent.quantity} × ${intent.product}  $${intent.amount}  capture ${paid.order?.captureId || "pending"}`);
  } catch (e) {
    console.log(`✗ "${task}": ${e.message}`);
  }
}
console.log("\nDone. Open one of these payments in the PayPal sandbox buyer account to file the demo dispute.");
