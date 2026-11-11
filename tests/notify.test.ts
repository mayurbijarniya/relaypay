import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { setupEnv } from "./helpers.ts";

setupEnv({ NEXT_PUBLIC_BASE_URL: "https://demo.example.com" });

type Sent = { url: string; headers: Record<string, string>; body: any };
const sent: Sent[] = [];
let status = 200;
let failHost = "";
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  sent.push({ url: String(input), headers: init.headers || {}, body: JSON.parse(init.body) });
  return new Response("{}", { status: failHost && new URL(String(input)).host === failHost ? 500 : status });
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
  failHost = "";
  process.env.ALERT_WEBHOOK_URL = "";
  process.env.ZAPIER_WEBHOOK_URL = "";
  process.env.RESEND_API_KEY = "";
  process.env.ALERT_EMAIL_TO = "";
  process.env.ALERT_EMAIL_FROM = "";
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

// --- email through Resend -------------------------------------------------

const HASH = "a".repeat(64);
const emailOn = () => {
  process.env.RESEND_API_KEY = "re_test_key_123";
  process.env.ALERT_EMAIL_TO = "owner@example.com";
};

test("email needs both the API key and a valid recipient", async () => {
  const n = await notify();
  process.env.RESEND_API_KEY = "re_test_key_123";
  assert.equal(n.alertsEnabled(), false, "key alone is not enough");
  process.env.ALERT_EMAIL_TO = "not-an-email";
  assert.equal(n.alertsEnabled(), false, "an invalid recipient is ignored");
  process.env.ALERT_EMAIL_TO = "owner@example.com";
  assert.equal(n.alertsEnabled(), true);
  assert.equal(n.alertsChannel(), "email");
  process.env.RESEND_API_KEY = "";
  assert.equal(n.alertsEnabled(), false, "recipient alone is not enough");
});

test("email goes to Resend with the key in a header, never in the message", async () => {
  const n = await notify();
  emailOn();
  assert.deepEqual(await n.notifyOwner("payment_captured", { ...details, receiptHash: HASH }), { sent: true });
  assert.equal(sent.length, 1);
  const mail = sent[0];
  assert.equal(mail.url, "https://api.resend.com/emails");
  assert.equal((mail.headers as any).Authorization, "Bearer re_test_key_123");
  assert.equal(mail.body.from, "RelayPay <onboarding@resend.dev>");
  assert.deepEqual(mail.body.to, ["owner@example.com"]);
  assert.equal(mail.body.subject, details.title);
  assert.ok(mail.body.text.includes(`Receipt: https://demo.example.com/r/${HASH}`), "payment emails link the public receipt");
  assert.ok(mail.body.text.includes("https://demo.example.com/app#purchases"));
  assert.equal(JSON.stringify(mail.body).includes("re_test_key_123"), false, "the API key is not in the body");
});

test("email uses ALERT_EMAIL_FROM, caps recipients at three, and escapes HTML", async () => {
  const n = await notify();
  emailOn();
  process.env.ALERT_EMAIL_FROM = "RelayPay <alerts@example.com>";
  process.env.ALERT_EMAIL_TO = "a@example.com, b@example.com, bad, c@example.com, d@example.com";
  await n.notifyOwner("test", { ...details, title: "<b>x</b>", message: "1 < 2 & 3" });
  assert.equal(sent[0].body.from, "RelayPay <alerts@example.com>");
  assert.deepEqual(sent[0].body.to, ["a@example.com", "b@example.com", "c@example.com"]);
  assert.equal(sent[0].body.html.includes("<b>x</b>"), false);
  assert.ok(sent[0].body.html.includes("1 &lt; 2 &amp; 3"));
});

test("a malformed receipt hash adds no receipt link", async () => {
  const n = await notify();
  emailOn();
  await n.notifyOwner("payment_captured", { ...details, receiptHash: "../../etc/passwd" });
  assert.equal(sent[0].body.text.includes("Receipt:"), false);
});

test("a webhook and email both fire, and one failing does not hide the other", async () => {
  const n = await notify();
  emailOn();
  process.env.ALERT_WEBHOOK_URL = DISCORD;
  assert.equal(n.alertsChannel(), "Discord + email");
  assert.deepEqual(await n.notifyOwner("approval_needed", details), { sent: true });
  assert.deepEqual(sent.map((s) => new URL(s.url).host).sort(), ["api.resend.com", "discord.com"]);

  sent.length = 0;
  failHost = "discord.com";
  assert.deepEqual(await n.notifyOwner("approval_needed", details), { sent: true }, "email still goes out when Discord fails");
  failHost = "api.resend.com";
  assert.deepEqual(await n.notifyOwner("approval_needed", details), { sent: true }, "Discord still goes out when Resend fails");

  failHost = "";
  status = 403;
  assert.deepEqual(await n.notifyOwner("approval_needed", details), { sent: false, error: "Discord returned 403; Resend returned 403" });
});
