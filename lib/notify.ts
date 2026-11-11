import "server-only";

/**
 * Owner alerts (optional integration).
 *
 * RelayPay keeps a human in the loop, so the owner has to know when something
 * needs them. Set ALERT_WEBHOOK_URL to a Discord, Slack or ntfy.sh URL (all
 * free, none needs a paid plan) or a Zapier Catch Hook, and RelayPay posts a
 * short message for each event. ZAPIER_WEBHOOK_URL still works as before. No
 * secrets or PayPal tokens are ever included.
 *
 * Only these hosts are accepted, so a mistyped setting can't point the server
 * at an arbitrary address. Alerts never block or fail the request that
 * triggered them.
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

export function alertsEnabled() {
  return target() !== null;
}

/** "Discord", "Slack", "ntfy" or "Zapier"; empty when alerts are off. */
export function alertsChannel(): string {
  return target()?.channel || "";
}

function appUrl(hash = "") {
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return base ? `${base}/app${hash}` : undefined;
}

export async function notifyOwner(
  event: NotifyEvent,
  details: { title: string; message: string; amount?: string; view?: string; reference?: string }
): Promise<{ sent: boolean; error?: string }> {
  const t = target();
  if (!t) return { sent: false, error: "Alerts are not configured" };
  const link = appUrl(details.view ? `#${details.view}` : "");
  const text = [details.title, details.message, link].filter(Boolean);

  let url = t.url.toString();
  let body: Record<string, unknown>;
  if (t.channel === "Discord") body = { content: [`**${text[0]}**`, ...text.slice(1)].join("\n"), allowed_mentions: { parse: [] } };
  else if (t.channel === "Slack") body = { text: [`*${text[0]}*`, ...text.slice(1)].join("\n") };
  else if (t.channel === "ntfy") {
    // ntfy's JSON publish takes the topic in the body, so non-ASCII titles are safe.
    const topic = t.url.pathname.split("/").filter(Boolean)[0];
    url = `${t.url.origin}/`;
    body = { topic, title: details.title, message: details.message, ...(link ? { click: link } : {}) };
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return res.ok ? { sent: true } : { sent: false, error: `${t.channel} returned ${res.status}` };
  } catch (e: any) {
    return { sent: false, error: e?.name === "AbortError" ? `${t.channel} timed out` : `${t.channel} request failed` };
  } finally {
    clearTimeout(timer);
  }
}
