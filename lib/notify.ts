import "server-only";

/**
 * Zapier (optional integration) — owner notifications.
 *
 * RelayPay keeps a human in the loop, so the owner has to know when something
 * needs them. When ZAPIER_WEBHOOK_URL is set (a Zapier "Catch Hook" URL),
 * RelayPay posts a small JSON event that a Zap can turn into an email, SMS or
 * Slack message. No secrets or PayPal tokens are ever included.
 *
 * Notifications never block or fail the request that triggered them.
 */

export type NotifyEvent =
  | "approval_needed"
  | "payment_captured"
  | "dispute_opened"
  | "evidence_submitted"
  | "claim_accepted"
  | "test";

const TIMEOUT_MS = 4000;

export function zapierEnabled() {
  const url = process.env.ZAPIER_WEBHOOK_URL || "";
  return /^https:\/\/hooks\.zapier\.com\//.test(url);
}

function appUrl(hash = "") {
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return base ? `${base}/app${hash}` : undefined;
}

export async function notifyOwner(
  event: NotifyEvent,
  details: { title: string; message: string; amount?: string; view?: string; reference?: string }
): Promise<{ sent: boolean; error?: string }> {
  if (!zapierEnabled()) return { sent: false, error: "Zapier is not configured" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(String(process.env.ZAPIER_WEBHOOK_URL), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app: "RelayPay",
        event,
        title: details.title,
        message: details.message,
        amount: details.amount,
        reference: details.reference,
        link: appUrl(details.view ? `#${details.view}` : ""),
        sentAt: new Date().toISOString(),
      }),
      signal: controller.signal,
    });
    return res.ok ? { sent: true } : { sent: false, error: `Zapier returned ${res.status}` };
  } catch (e: any) {
    return { sent: false, error: e?.name === "AbortError" ? "Zapier timed out" : "Zapier request failed" };
  } finally {
    clearTimeout(timer);
  }
}
