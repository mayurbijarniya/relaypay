import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { setupEnv } from "./helpers.ts";

setupEnv({ NEXT_PUBLIC_BASE_URL: "https://demo.example.com" });

type Sent = { url: string; headers: Record<string, string>; body: any };
const sent: Sent[] = [];
let status = 200;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  sent.push({ url: String(input), headers: init.headers || {}, body: JSON.parse(init.body) });
  return new Response("{}", { status });
}) as typeof fetch;
after(() => {
  globalThis.fetch = realFetch;
});

let mod: Promise<typeof import("@/lib/notify")> | undefined;
const notify = () => (mod ??= import("@/lib/notify"));

const DISCORD = "https://discord.com/api/webhooks/123/abc";
const SLACK = "https://hooks.slack.com/services/T0/B0/xyz";
const NTFY = "https://ntfy.sh/relaypay-cafe-alerts";
const ZAPIER = "https://hooks.zapier.com/hooks/catch/1/abc/";
const details = { title: "Café approval needed: 3 × Coffee beans", message: "The agent proposed a $126.00 order.", amount: "126.00", view: "purchases", reference: "intent-1" };

beforeEach(() => {
  sent.length = 0;
  status = 200;
  process.env.ALERT_WEBHOOK_URL = "";
  process.env.ZAPIER_WEBHOOK_URL = "";
});

test("alerts are off until a supported URL is set", async () => {
  const n = await notify();
  assert.equal(n.alertsEnabled(), false);
  assert.equal(n.alertsChannel(), "");
  const res = await n.notifyOwner("test", details);
  assert.equal(res.sent, false);
  assert.equal(sent.length, 0);
});

test("only the supported hosts are accepted", async () => {
  const n = await notify();
  for (const bad of ["http://discord.com/api/webhooks/1/a", "https://evil.example.com/api/webhooks/1/a", "https://discord.com.evil.example/api/webhooks/1/a", "https://hooks.slack.com/other", "https://ntfy.sh/", "https://ntfy.sh/a/b", "http://169.254.169.254/", "not a url"]) {
    process.env.ALERT_WEBHOOK_URL = bad;
    assert.equal(n.alertsEnabled(), false, bad);
  }
});

test("Discord gets a bold title, the message and a link, with mentions disabled", async () => {
  const n = await notify();
  process.env.ALERT_WEBHOOK_URL = DISCORD;
  assert.equal(n.alertsChannel(), "Discord");
  assert.deepEqual(await n.notifyOwner("approval_needed", details), { sent: true });
  assert.equal(sent[0].url, DISCORD);
  assert.equal(sent[0].body.content, "**Café approval needed: 3 × Coffee beans**\nThe agent proposed a $126.00 order.\nhttps://demo.example.com/app#purchases");
  assert.deepEqual(sent[0].body.allowed_mentions, { parse: [] });
});

test("Slack gets a text message", async () => {
  const n = await notify();
  process.env.ALERT_WEBHOOK_URL = SLACK;
  assert.equal((await n.notifyOwner("payment_captured", details)).sent, true);
  assert.equal(sent[0].url, SLACK);
  assert.match(sent[0].body.text, /^\*Café approval needed: 3 × Coffee beans\*\n/);
});

test("ntfy uses the JSON publish API so non-ASCII titles are safe", async () => {
  const n = await notify();
  process.env.ALERT_WEBHOOK_URL = NTFY;
  assert.equal((await n.notifyOwner("dispute_opened", details)).sent, true);
  assert.equal(sent[0].url, "https://ntfy.sh/");
  assert.deepEqual(sent[0].body, { topic: "relaypay-cafe-alerts", title: details.title, message: details.message, click: "https://demo.example.com/app#purchases" });
  assert.equal(Object.keys(sent[0].headers).some((h) => h.toLowerCase() === "title"), false);
});

test("a Zapier hook set the old way still works and keeps its JSON shape", async () => {
  const n = await notify();
  process.env.ZAPIER_WEBHOOK_URL = ZAPIER;
  assert.equal(n.alertsChannel(), "Zapier");
  assert.equal((await n.notifyOwner("approval_needed", details)).sent, true);
  assert.equal(sent[0].body.app, "RelayPay");
  assert.equal(sent[0].body.event, "approval_needed");
  assert.equal(sent[0].body.amount, "126.00");
});

test("ALERT_WEBHOOK_URL wins over ZAPIER_WEBHOOK_URL", async () => {
  const n = await notify();
  process.env.ALERT_WEBHOOK_URL = DISCORD;
  process.env.ZAPIER_WEBHOOK_URL = ZAPIER;
  assert.equal(n.alertsChannel(), "Discord");
});

test("a rejected alert reports the channel and status without throwing", async () => {
  const n = await notify();
  process.env.ALERT_WEBHOOK_URL = DISCORD;
  status = 404;
  assert.deepEqual(await n.notifyOwner("test", details), { sent: false, error: "Discord returned 404" });
});
