/**
 * Client-safe formatting and plain-language labels.
 * Everything a person reads in the UI goes through here, so wording stays
 * consistent between cards, grids, drawers and the activity feed.
 */

export type AnyRecord = Record<string, any>;

export function money(value: unknown, currency = "USD") {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

export function shortId(value: unknown, head = 8, tail = 4) {
  if (!value) return "—";
  const s = String(value);
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function dateTime(value: unknown) {
  if (!value) return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function timeAgo(value: unknown) {
  if (!value) return "";
  const d = new Date(String(value)).getTime();
  if (!Number.isFinite(d)) return "";
  const seconds = Math.round((Date.now() - d) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/[._]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

export const INTENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  PROPOSED: { label: "Awaiting café approval", tone: "warn" },
  APPROVED: { label: "Approved · ready to charge", tone: "info" },
  CAPTURED: { label: "Charged with PayPal", tone: "ok" },
  REJECTED: { label: "Rejected", tone: "neutral" },
  DISPUTED: { label: "Disputed", tone: "bad" },
};

export type Tone = "ok" | "warn" | "bad" | "info" | "neutral" | "brand";

export function agentModeLabel(mode?: string) {
  if (mode === "LLM_TOOLS") return "Live AI · tool calling";
  if (mode === "LLM_JSON") return "Live AI · JSON tools";
  if (mode === "FALLBACK") return "Offline fallback";
  return "Agent";
}

// ---------------------------------------------------------------------------
// Agent tools
// ---------------------------------------------------------------------------

export const TOOL_LABEL: Record<string, string> = {
  get_low_stock_products: "Looked for low stock",
  search_catalog: "Searched the catalog",
  check_inventory: "Checked stock",
  check_budget: "Checked today's budget",
  compare_market_prices: "Compared market prices (Channel3)",
  propose_purchase: "Proposed the purchase",
  get_dispute: "Read the PayPal dispute",
  get_receipt: "Pulled the approved receipt",
  get_event_timeline: "Read the provenance timeline",
  get_paypal_confirmation: "Re-read the capture from PayPal",
  verify_hash: "Compared the receipt hash with PayPal",
  decide_case: "Decided the case",
};

export function toolInputSummary(call: AnyRecord): string {
  const input = call?.input || {};
  switch (call?.tool) {
    case "search_catalog":
      return input.query ? `“${input.query}”` : "";
    case "check_inventory":
      return input.product || "";
    case "check_budget":
      return input.amount ? money(input.amount) : "";
    case "propose_purchase":
      return input.product ? `${input.quantity || 1} × ${input.product}` : "";
    case "compare_market_prices":
      return input.product || "";
    default:
      return "";
  }
}

export function toolOutputSummary(call: AnyRecord): string {
  const out = call?.output;
  if (out == null) return "";
  if (out.error) return String(out.error);
  switch (call?.tool) {
    case "search_catalog": {
      const rows = Array.isArray(out) ? out : Array.isArray(out.results) ? out.results : [];
      if (!rows.length) return "No matching products";
      return `${rows.length} match${rows.length === 1 ? "" : "es"}: ${rows.map((r: AnyRecord) => r.product).join(", ")}`;
    }
    case "get_low_stock_products": {
      const rows = Array.isArray(out.lowStock) ? out.lowStock : [];
      return rows.length ? rows.map((r: AnyRecord) => `${r.product} (${r.onHand} left)`).join(", ") : "Nothing is below its reorder point";
    }
    case "check_inventory":
      if (out.onHand != null) {
        return `${out.onHand} on hand · reorder at ${out.reorderPoint} · ${out.suggestedQuantity ? `suggests ${out.suggestedQuantity}` : "no reorder needed"} · ${money(out.unitPrice)} each`;
      }
      return `${out.stock} in stock at ${money(out.unitPrice)}`;
    case "compare_market_prices":
      if (out.available === false) return "Channel3 not configured";
      if (out.verdict === "NO_DATA") return out.note || "No live offers found";
      return `${String(out.verdict).replace(/_/g, " ").toLowerCase()} · median ${money(out.medianMarketPrice)} across ${out.offerCount} offers`;
    case "get_event_timeline":
      return `${out.count} event${out.count === 1 ? "" : "s"}${out.vaultApprovedAt ? " · Vault consent on record" : ""}`;
    case "get_paypal_confirmation":
      return out.found ? `${out.status} · ${money(out.amount)} · ${dateTime(out.createTime)}` : out.note || "Not found";
    case "check_budget":
      return out.withinBudget
        ? `Within budget · ${money(out.remainingToday)} left today`
        : `Over budget · only ${money(out.remainingToday)} left today`;
    case "propose_purchase":
      return out.accepted ? `${out.quantity} × ${out.product} = ${money(out.computedAmount)}` : "Rejected";
    case "get_dispute":
      return `${reasonLabel(out.reason)} · ${titleCase(String(out.status || ""))}`;
    case "get_receipt":
      return out.found ? `Approved by ${out.approvedBy} · ${dateTime(out.approvedAt)}` : "No approved receipt linked";
    case "verify_hash":
      if (out.matches && out.paypalRecord) return `Match · hash found in the PayPal ${out.paypalRecord} record`;
      if (out.matches) return "Matches RelayPay's copy only (PayPal returned no custom_id)";
      if (out.paypalMatches === false) return "Mismatch · PayPal holds a different hash";
      return "No receipt hash to compare";
    case "decide_case":
      return `${out.recommendation === "CONTEST" ? "Contest" : "Refund"}${out.classification ? ` · ${out.classification}` : ""}`;
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

export function reasonLabel(reason?: string) {
  switch (String(reason || "").toUpperCase()) {
    case "UNAUTHORISED":
    case "UNAUTHORIZED":
      return "Buyer says they didn't authorize this payment";
    case "MERCHANDISE_OR_SERVICE_NOT_RECEIVED":
      return "Buyer says the order never arrived";
    case "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED":
      return "Buyer says the item wasn't as described";
    case "DUPLICATE_TRANSACTION":
      return "Buyer says they were charged twice";
    case "INCORRECT_AMOUNT":
      return "Buyer says the amount was wrong";
    case "":
    case "UNKNOWN":
      return "Dispute reason not provided";
    default:
      return titleCase(String(reason));
  }
}

export const HASH_SOURCE_TEXT: Record<string, string> = {
  PAYPAL_DISPUTE_CUSTOM_ID: "PayPal dispute record",
  PAYPAL_CAPTURE_CUSTOM_ID: "PayPal capture record",
  PAYPAL_ORDER_CUSTOM_ID: "PayPal order record",
  STORED_RECEIPT: "RelayPay's copy only",
  MISMATCH: "does not match PayPal",
  NO_RECEIPT: "no receipt linked",
};

export function isPayPalVerified(source?: string) {
  return !!source && source.startsWith("PAYPAL_") && source.endsWith("_CUSTOM_ID");
}

export function isSample(dispute: AnyRecord) {
  return dispute?.simulator === true || dispute?.paypalDisputeId === "simulated";
}

/** Still waiting on the merchant: not sent, not resolved, and not a sample that was already approved. */
export function needsDecision(dispute: AnyRecord) {
  if (dispute?.submitted || dispute?.resolution) return false;
  return !(isSample(dispute) && dispute?.merchantApproved);
}

export function disputeStage(d: AnyRecord): { label: string; tone: Tone } {
  if (d.resolution === "ACCEPTED") return { label: "Refunded", tone: "neutral" };
  if (d.submitted) return { label: "Evidence sent to PayPal", tone: "ok" };
  if (d.resolution === "CONTESTED") return { label: "Contested", tone: "ok" };
  if (d.merchantApproved) return { label: "Approved · ready to send", tone: "info" };
  return { label: "Draft ready for review", tone: "warn" };
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

const EVENT_LABEL: Record<string, string> = {
  PROPOSED: "Agent proposed a purchase",
  JUDGE_PROPOSED: "Agent proposed a purchase (guided demo)",
  APPROVED: "Café approved · receipt sealed",
  REJECTED: "Café rejected a proposal",
  ORDER_CAPTURED: "PayPal captured the payment",
  ORDER_CREATED_CAPTURE: "PayPal captured the payment",
  ORDER_PENDING: "PayPal order created · capture pending",
  CAPTURE_COMPLETED: "PayPal confirmed the capture",
  CAPTURE_MISMATCH: "PayPal capture did not match the receipt",
  CAPTURE_ORPHAN: "PayPal capture with no matching receipt",
  RECEIPT_VERIFIED: "Receipt verified against PayPal",
  RECEIPT_VERIFY_FAILED: "Receipt verification failed",
  DISPUTE_DRAFTED: "Dispute agent drafted a response",
  SIMULATED_DISPUTE_DRAFTED: "Dispute agent drafted a sample response",
  SIMULATOR_DISPUTE_DRAFTED: "Dispute agent drafted a sample response",
  DISPUTE_WEBHOOK_AUTO_DRAFTED: "New PayPal dispute · agent drafted a response",
  DISPUTE_DRAFT_APPROVED: "Supplier approved the dispute response",
  EVIDENCE_SUBMITTED: "Evidence sent to PayPal",
  CLAIM_ACCEPTED: "Supplier refunded the café",
  DISPUTE_DRAFT_FAILED: "Dispute draft failed",
  DISPUTE_ORPHAN: "Dispute webhook without an ID",
  SIMULATOR_EVENT_IGNORED: "Simulator event recorded",
  SIMULATOR_DRAFT_FAILED: "Simulator draft failed",
  VAULT_CONNECTED: "PayPal Vault connected",
  DISPUTE_SYNCED_DRAFTED: "Found a PayPal dispute · agent drafted a response",
  DISPUTE_ADVANCED: "Dispute moved forward in the PayPal sandbox",
  SANDBOX_DISPUTE_OPENED: "Sandbox dispute opened on PayPal",
  STOCK_CONSUMED: "A café day used up stock",
  STOCK_RECEIVED: "Stock received from a paid order",
  RECONCILED: "Payments reconciled with PayPal Transaction Search",
  OWNER_NOTIFIED: "Notification sent (Zapier)",
  DEMO_RESET: "Demo data reset",
  "CUSTOMER.DISPUTE.UPDATED": "PayPal updated the dispute",
  "CUSTOMER.DISPUTE.RESOLVED": "PayPal resolved the dispute",
};

export function eventLabel(eventType?: string) {
  if (!eventType) return "Event";
  return EVENT_LABEL[eventType] || titleCase(eventType);
}

export const ACTOR_LABEL: Record<string, string> = {
  AGENT: "AI agent",
  OWNER: "Café",
  MERCHANT: "Supplier",
  PAYPAL: "PayPal",
  SYSTEM: "RelayPay",
};

