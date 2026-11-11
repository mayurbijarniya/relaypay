import "server-only";

/**
 * Owner alerts (optional integration).
 *
 * RelayPay keeps a human in the loop, so the owner has to know when something
 * needs them. Two channels, either or both:
 * - ALERT_WEBHOOK_URL: a Discord, Slack or ntfy.sh URL (all free) or a Zapier
 *   Catch Hook. ZAPIER_WEBHOOK_URL still works as before.
 * - Email through Resend: RESEND_API_KEY plus ALERT_EMAIL_TO. Payment alerts
 *   carry a link to the public receipt page.
 *
 * No secrets or PayPal tokens are ever put in a message. Webhook hosts are
 * limited to the ones above, so a mistyped setting can't point the server at an
 * arbitrary address. Alerts never block or fail the request that triggered them.
 */

export type NotifyEvent =
  | "approval_needed"
  | "payment_captured"
  | "dispute_opened"
  | "evidence_submitted"
  | "claim_accepted"
  | "test";

const TIMEOUT_MS = 4000;

type Channel = "Discord" | "Slack" | "ntfy" | "Zapier";
type Target = { channel: Channel; url: URL };

function parseTarget(raw: string): Target | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if ((host === "discord.com" || host === "discordapp.com") && url.pathname.startsWith("/api/webhooks/")) return { channel: "Discord", url };
  if (host === "hooks.slack.com" && url.pathname.startsWith("/services/")) return { channel: "Slack", url };
  if (host === "ntfy.sh" && url.pathname.split("/").filter(Boolean).length === 1) return { channel: "ntfy", url };
  if (host === "hooks.zapier.com") return { channel: "Zapier", url };
  return null;
}

function target(): Target | null {
  return parseTarget(process.env.ALERT_WEBHOOK_URL || "") || parseTarget(process.env.ZAPIER_WEBHOOK_URL || "");
}

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

function emailRecipients(): string[] {
  return String(process.env.ALERT_EMAIL_TO || "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => EMAIL_RE.test(e))
    .slice(0, 3);
}

function emailEnabled() {
  return !!process.env.RESEND_API_KEY && emailRecipients().length > 0;
}

export function alertsEnabled() {
  return target() !== null || emailEnabled();
}

/** "Discord", "email", "Discord + email", ...; empty when alerts are off. */
export function alertsChannel(): string {
  return [target()?.channel, emailEnabled() ? "email" : ""].filter(Boolean).join(" + ");
}

function appUrl(hash = "") {
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return base ? `${base}/app${hash}` : undefined;
}

function receiptUrl(receiptHash?: string) {
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return base && receiptHash && /^[a-f0-9]{64}$/.test(receiptHash) ? `${base}/r/${receiptHash}` : undefined;
}

type Details = { title: string; message: string; amount?: string; view?: string; reference?: string; receiptHash?: string };
type Result = { sent: boolean; error?: string };

async function post(label: string, url: string, init: { headers?: Record<string, string>; body: unknown }): Promise<Result> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...init.headers },
      body: JSON.stringify(init.body),
      signal: controller.signal,
    });
    return res.ok ? { sent: true } : { sent: false, error: `${label} returned ${res.status}` };
  } catch (e: any) {
    return { sent: false, error: e?.name === "AbortError" ? `${label} timed out` : `${label} request failed` };
  } finally {
    clearTimeout(timer);
  }
}

const escapeHtml = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function sendEmail(details: Details, lines: string[]): Promise<Result> {
  const from = process.env.ALERT_EMAIL_FROM || "RelayPay <onboarding@resend.dev>";
  const html = lines.map((l) => `<p>${escapeHtml(l).replace(/(https:\/\/\S+)/g, '<a href="$1">$1</a>')}</p>`).join("");
  return post("Resend", "https://api.resend.com/emails", {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: { from, to: emailRecipients(), subject: details.title, text: lines.join("\n\n"), html },
  });
}

function sendWebhook(t: Target, event: NotifyEvent, details: Details, link: string | undefined, lines: string[]): Promise<Result> {
  let url = t.url.toString();
  let body: Record<string, unknown>;
  if (t.channel === "Discord") body = { content: [`**${lines[0]}**`, ...lines.slice(1)].join("\n"), allowed_mentions: { parse: [] } };
  else if (t.channel === "Slack") body = { text: [`*${lines[0]}*`, ...lines.slice(1)].join("\n") };
  else if (t.channel === "ntfy") {
    // ntfy's JSON publish takes the topic in the body, so non-ASCII titles are safe.
    const topic = t.url.pathname.split("/").filter(Boolean)[0];
    url = `${t.url.origin}/`;
    body = { topic, title: details.title, message: lines.slice(1).filter((l) => l !== link).join("\n"), ...(link ? { click: link } : {}) };
  } else {
    body = {
      app: "RelayPay",
      event,
      title: details.title,
      message: details.message,
      amount: details.amount,
      reference: details.reference,
      link,
      sentAt: new Date().toISOString(),
    };
  }
  return post(t.channel, url, { body });
}

export async function notifyOwner(event: NotifyEvent, details: Details): Promise<Result> {
  const t = target();
  const email = emailEnabled();
  if (!t && !email) return { sent: false, error: "Alerts are not configured" };
  const link = appUrl(details.view ? `#${details.view}` : "");
  const receipt = receiptUrl(details.receiptHash);
  const lines = [details.title, details.message, receipt ? `Receipt: ${receipt}` : undefined, link].filter((l): l is string => !!l);

  const results = await Promise.all([t ? sendWebhook(t, event, details, link, lines) : null, email ? sendEmail(details, lines) : null]);
  const sent = results.filter((r): r is Result => !!r);
  return sent.some((r) => r.sent) ? { sent: true } : { sent: false, error: sent.map((r) => r.error).join("; ") };
}
