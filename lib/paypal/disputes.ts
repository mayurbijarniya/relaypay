import "server-only";
import { paypalFetch, getAccessToken, paypalBaseUrl } from "./client";
import { getCapture, getOrder } from "./orders";

export type PayPalCustomId = {
  customId?: string;
  origin?: "DISPUTE" | "CAPTURE" | "ORDER";
  checked: string[];
};

/**
 * Find PayPal's own copy of the receipt hash for a disputed transaction.
 *
 * Order of preference:
 * 1. `disputed_transactions[].custom` on the dispute itself.
 * 2. `custom_id` on the capture the dispute points at (seller_transaction_id).
 * 3. `custom_id` on the PayPal order RelayPay linked to that capture.
 *
 * Every value comes from a PayPal API response, never from a request body.
 * Sandbox disputes do not always echo `custom`, so the capture is the
 * reliable fallback: it is the exact transaction the buyer disputed.
 */
export async function resolvePayPalCustomId(input: {
  dispute?: any;
  captureId?: string;
  paypalOrderId?: string;
}): Promise<PayPalCustomId> {
  const checked: string[] = [];
  const transaction = Array.isArray(input.dispute?.disputed_transactions)
    ? input.dispute.disputed_transactions[0]
    : undefined;

  if (input.dispute) {
    checked.push("dispute");
    const fromDispute = transaction?.custom || input.dispute?.custom_id;
    if (fromDispute) return { customId: String(fromDispute), origin: "DISPUTE", checked };
  }

  const captureId = transaction?.seller_transaction_id || input.captureId;
  if (captureId) {
    checked.push("capture");
    try {
      const capture = await getCapture(captureId);
      if (capture?.custom_id) return { customId: String(capture.custom_id), origin: "CAPTURE", checked };
    } catch {
      // Fall through to the order lookup.
    }
  }

  if (input.paypalOrderId) {
    checked.push("order");
    try {
      const order = await getOrder(input.paypalOrderId);
      const unit = order?.purchase_units?.[0];
      const customId = unit?.custom_id || unit?.payments?.captures?.[0]?.custom_id;
      if (customId) return { customId: String(customId), origin: "ORDER", checked };
    } catch {
      // No PayPal copy available.
    }
  }

  return { checked };
}

export type DisputeDetail = {
  dispute_id: string;
  reason: string;
  status: string;
  dispute_life_cycle_stage?: string;
  disputed_transactions?: Array<{
    buyer_transaction_id: string;
    seller_transaction_id: string;
    custom?: string;
  }>;
  evidences?: Array<{ evidence_type: string; source?: string; notes?: string }>;
  links?: Array<{ href: string; rel: string; method: string }>;
  [key: string]: unknown;
};

export async function getDispute(disputeId: string) {
  return paypalFetch<DisputeDetail>(`/v1/customer/disputes/${disputeId}`);
}

/** Recent disputes for this merchant, newest first. */
export async function listDisputes(params: { pageSize?: number } = {}) {
  const size = Math.max(1, Math.min(50, params.pageSize || 20));
  return paypalFetch<any>(`/v1/customer/disputes?page_size=${size}`);
}

/** HATEOAS link names PayPal currently offers for a dispute (e.g. "escalate", "require-evidence"). */
export function disputeActions(dispute: any): string[] {
  const links: any[] = Array.isArray(dispute?.links) ? dispute.links : [];
  return links
    .map((l) => String(l?.rel || "").toLowerCase())
    .concat(links.map((l) => String(l?.href || "").split("/").pop() || "").filter(Boolean))
    .filter((v, i, all) => !!v && all.indexOf(v) === i);
}

/** Turn an inquiry into a claim (OPEN → UNDER_REVIEW). */
export async function escalateDispute(disputeId: string, note = "Escalating to a PayPal claim for review.") {
  return paypalFetch(`/v1/customer/disputes/${disputeId}/escalate`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

/** Sandbox only: UNDER_REVIEW → WAITING_FOR_SELLER_RESPONSE. */
export async function requireSellerEvidence(disputeId: string) {
  return paypalFetch(`/v1/customer/disputes/${disputeId}/require-evidence`, {
    method: "POST",
    body: JSON.stringify({ action: "SELLER_EVIDENCE" }),
  });
}

/**
 * PayPal-Auth-Assertion for acting as the sandbox buyer, exactly as PayPal's
 * sandbox dispute guide builds it: an unsigned JWT ({"alg":"none"}) whose
 * payload is the merchant client ID and the buyer's email, with PayPal's
 * base64url variant and a trailing dot.
 */
function buyerAssertion(clientId: string, buyerEmail: string) {
  const enc = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "-");
  return `${enc({ alg: "none", typ: "JWT" })}.${enc({ iss: clientId, email: buyerEmail })}.`;
}

/**
 * Sandbox only: open a dispute as the buyer. Needs the buyer-side transaction
 * ID (from the sandbox buyer's activity page) and the DISPUTE_CREATE scope on
 * the REST app. PayPal enables that scope on request, so callers must handle
 * a 401/403 and fall back to the Resolution Center.
 */
export async function createSandboxDispute(input: {
  clientId: string;
  buyerEmail: string;
  buyerTransactionId: string;
  amount: string;
  currency: string;
  reason: string;
}) {
  const token = await getAccessToken();
  const form = new FormData();
  form.append(
    "input",
    new Blob(
      [
        JSON.stringify({
          disputed_transactions: [{ buyer_transaction_id: input.buyerTransactionId }],
          reason: input.reason,
          dispute_amount: { currency_code: input.currency, value: input.amount },
          extensions: {
            merchant_contacted: true,
            merchant_contacted_outcome: "NO_RESPONSE",
            merchandize_dispute_properties: { issue_type: "PRODUCT" },
          },
        }),
      ],
      { type: "application/json" }
    )
  );
  const res = await fetch(`${paypalBaseUrl}/v1/customer/disputes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "PayPal-Auth-Assertion": buyerAssertion(input.clientId, input.buyerEmail),
    },
    body: form,
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, body: json };
}

export async function provideEvidence(
  disputeId: string,
  input: { evidences: Array<{ evidence_type: string; notes?: string; evidence_info?: Record<string, unknown> }> },
  file?: { name: string; buffer: Buffer; mime: string }
) {
  const token = await getAccessToken();
  const form = new FormData();
  form.append("input", JSON.stringify(input));
  if (file) {
    form.append("file1", new Blob([new Uint8Array(file.buffer)], { type: file.mime }), file.name);
  }
  const res = await fetch(`${paypalBaseUrl}/v1/customer/disputes/${disputeId}/provide-evidence`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) throw new Error(`provide-evidence failed: ${res.status} ${await res.text()}`);
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function acceptClaim(disputeId: string, note = "Refund issued.") {
  return paypalFetch(`/v1/customer/disputes/${disputeId}/accept-claim`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}
