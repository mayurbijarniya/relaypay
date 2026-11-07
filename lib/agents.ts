import "server-only";
import { env } from "@/lib/env";
import { createHash } from "crypto";
import {
  CATALOG,
  DAILY_CAP_USD,
  HIGH_VALUE_USD,
  MAX_QUANTITY,
  MAX_SINGLE_PURCHASE_USD,
  centsFromUsd,
  evaluatePolicy,
  lowStock,
  matchProduct,
  searchCatalog,
  stockRow,
  usd,
  type PolicyChecks,
} from "@/lib/policy";
import { hashReceipt, type IntentReceipt, type MarketCheck } from "@/lib/receipts";
import { channel3Enabled, marketCheck } from "@/lib/channel3";

/**
 * RelayPay's two agents.
 *
 * Agents never hold PayPal credentials and never call PayPal to move money.
 * They propose and draft; the backend executes after a human approves.
 *
 * Both agents use a real tool-calling loop: the model chooses a tool, the
 * backend executes it, the result goes back to the model. Every call is
 * recorded with its source (LLM or FALLBACK). If the provider rejects `tools`,
 * the same loop runs in JSON mode. With no LLM key, a deterministic fallback
 * runs and is labelled as such.
 */

const LLM_BASE_URL = process.env.LLM_BASE_URL || "https://api.subconscious.dev/v1";
const LLM_MODEL = process.env.LLM_MODEL || "subconscious/glm-5.3-marathon";
const LLM_TIMEOUT_MS = 45_000;
const MAX_STEPS = 10;

export const AGENT_ID = "relaypay-cafe-agent-1";
export const AGENT_MODEL = LLM_MODEL;

type TraceSource = "LLM" | "FALLBACK";
export type ToolCall = { tool: string; input: any; output: any; at: string; source: TraceSource };

const now = () => new Date().toISOString();
const trace = (tool: string, input: any, output: any, source: TraceSource): ToolCall => ({ tool, input, output, at: now(), source });

/** PayPal caps dispute evidence notes; keep the payload valid. */
export const EVIDENCE_NOTES_LIMIT = 2000;

type LLMResult = { ok: true; message: any } | { ok: false; toolsUnsupported?: boolean };

async function llmChat(messages: any[], tools?: any[]): Promise<LLMResult> {
  if (!env.llmApiKey) return { ok: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.llmApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0,
        messages,
        ...(tools ? { tools, tool_choice: "auto" } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, toolsUnsupported: !!tools && [400, 404, 422].includes(res.status) };
    const data = await res.json();
    const message = data.choices?.[0]?.message;
    return message ? { ok: true, message } : { ok: false };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

async function llmText(system: string, user: string): Promise<string | null> {
  const result = await llmChat([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
  if (!result.ok) return null;
  const content = result.message?.content;
  return typeof content === "string" && content.trim() ? content.trim() : null;
}

function parseJsonObject(text: string): any | null {
  if (!text) return null;
  const cleaned = text.replace(/```json|```/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {}
    }
    return null;
  }
}

export function promptHash(text: string) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * Generic tool loop used by both agents: native tool calling first, JSON-mode
 * tool calling if the provider rejects `tools`.
 */
async function runToolLoop(opts: {
  system: string;
  user: string;
  tools: any[];
  run: (name: string, args: any) => Promise<any>;
  done: () => boolean;
  traceLength: () => number;
}) {
  const messages: any[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];
  let toolsUnsupported = false;
  let mode: "LLM_TOOLS" | "LLM_JSON" | null = null;

  for (let step = 0; step < MAX_STEPS && !opts.done(); step++) {
    const result = await llmChat(messages, opts.tools);
    if (!result.ok) {
      toolsUnsupported = !!result.toolsUnsupported;
      break;
    }
    const calls: any[] = Array.isArray(result.message.tool_calls) ? result.message.tool_calls : [];
    if (calls.length === 0) break;
    mode = "LLM_TOOLS";
    messages.push({ role: "assistant", content: result.message.content || "", tool_calls: calls });
    for (const call of calls) {
      const name = call.function?.name;
      const args = parseJsonObject(call.function?.arguments || "{}") || {};
      const output = await opts.run(name, args);
      messages.push({ role: "tool", tool_call_id: call.id || `call_${step}`, name, content: JSON.stringify(output) });
      if (opts.done()) break;
    }
  }
  if (opts.done()) return mode || "LLM_TOOLS";

  if (toolsUnsupported || opts.traceLength() === 0) {
    const names = opts.tools.map((t) => t.function.name).join("|");
    const jsonSystem = `${opts.system}
You cannot call tools directly. Reply with exactly one JSON object and nothing else:
{"tool":"<${names}>","input":{...}}
The backend executes it and sends you the result. Continue until the final tool.`;
    const history: any[] = [];
    for (let step = 0; step < MAX_STEPS && !opts.done(); step++) {
      const text = await llmText(jsonSystem, `${opts.user}\nPrevious tool calls: ${JSON.stringify(history)}`);
      const turn = parseJsonObject(text || "");
      if (!turn?.tool) break;
      const output = await opts.run(String(turn.tool), turn.input || {});
      history.push({ tool: turn.tool, input: turn.input || {}, output });
      mode = "LLM_JSON";
    }
  }
  return opts.done() ? mode || "LLM_JSON" : null;
}

// ===========================================================================
// Purchase agent
// ===========================================================================

export type Proposal = {
  product: string;
  quantity: number;
  amount: string;
  currency: string;
  rationale: string;
  alternatives: string[];
  toolCalls: ToolCall[];
  agentId: string;
  model: string;
  promptHash: string;
  policyChecks: PolicyChecks;
  marketCheck?: MarketCheck;
  agentMode: "LLM_TOOLS" | "LLM_JSON" | "FALLBACK";
};

const PURCHASE_SYSTEM = `You are the purchasing agent a coffee supplier runs for its cafe customer.
You order only from the supplier's fixed catalog. Never invent a product or a price.
You cannot pay. You propose exactly one order; the cafe owner approves it, then the supplier charges the cafe through PayPal.
Work like this:
1. If the request is general ("check stock", "reorder what's low"), call get_low_stock_products first and pick the most urgent item.
   Otherwise call search_catalog for what was asked.
2. call check_inventory for the chosen product. Its suggestedQuantity tops stock back up to the par level.
3. call check_budget for unit price × quantity.
4. If compare_market_prices is available, call it for the chosen product.
5. call propose_purchase with the product, quantity, a two-sentence rationale, and alternatives.
The backend recomputes the amount from catalog price × quantity, so never send an amount.
Quantity must be between 1 and ${MAX_QUANTITY}. Prefer the suggested quantity unless the owner asked for something specific.`;

function purchaseTools() {
  const tools: any[] = [
    {
      type: "function",
      function: {
        name: "get_low_stock_products",
        description: "List catalog products at or below their reorder point, most urgent first, with a suggested reorder quantity.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "search_catalog",
        description: "Search the cafe's supplier catalog. Returns matching products with unit price and units on hand.",
        parameters: {
          type: "object",
          properties: { query: { type: "string", description: "What to search for, e.g. coffee beans" } },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "check_inventory",
        description: "Stock level, reorder point, par level, daily usage and suggested reorder quantity for one catalog product.",
        parameters: {
          type: "object",
          properties: { product: { type: "string", description: "Exact catalog product name" } },
          required: ["product"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "check_budget",
        description: "Check whether an amount fits today's remaining spend cap.",
        parameters: {
          type: "object",
          properties: { amount: { type: "string", description: "Amount in USD, e.g. 84.00" } },
          required: ["amount"],
        },
      },
    },
  ];
  if (channel3Enabled()) {
    tools.push({
      type: "function",
      function: {
        name: "compare_market_prices",
        description: "Compare the supplier's unit price with live retail offers from the Channel3 product catalog.",
        parameters: {
          type: "object",
          properties: { product: { type: "string", description: "Exact catalog product name" } },
          required: ["product"],
        },
      },
    });
  }
  tools.push({
    type: "function",
    function: {
      name: "propose_purchase",
      description: "Finish with one purchase proposal. The backend computes and validates the amount.",
      parameters: {
        type: "object",
        properties: {
          product: { type: "string", description: "Exact catalog product name" },
          quantity: { type: "integer", minimum: 1, maximum: MAX_QUANTITY },
          rationale: { type: "string" },
          alternatives: { type: "array", items: { type: "string" } },
        },
        required: ["product", "quantity", "rationale"],
      },
    },
  });
  return tools;
}

type PurchaseCtx = {
  spentTodayCents: number;
  inventory: Record<string, number>;
  trace: ToolCall[];
  marketCheck?: MarketCheck;
  final?: { product: string; quantity: number; rationale: string; alternatives: string[] };
};

async function runPurchaseTool(name: string, args: any, ctx: PurchaseCtx, source: TraceSource): Promise<any> {
  const input = args && typeof args === "object" ? args : {};
  const record = (output: any) => {
    ctx.trace.push(trace(name, input, output, source));
    return output;
  };

  switch (name) {
    case "get_low_stock_products": {
      const rows = lowStock(ctx.inventory).map((r) => ({
        product: r.product,
        onHand: r.onHand,
        reorderPoint: r.reorderPoint,
        daysLeft: r.daysLeft,
        suggestedQuantity: r.suggestedQuantity,
        unitPrice: r.unitPrice,
      }));
      return record({ lowStock: rows, count: rows.length });
    }
    case "search_catalog":
      return record({ results: searchCatalog(String(input.query || ""), ctx.inventory) });
    case "check_inventory": {
      const product = matchProduct(String(input.product || ""));
      if (!product) return record({ error: "unknown product", catalog: Object.keys(CATALOG) });
      return record(stockRow(product, ctx.inventory));
    }
    case "check_budget": {
      const amountCents = centsFromUsd(input.amount || 0);
      const remaining = Math.max(0, DAILY_CAP_USD * 100 - ctx.spentTodayCents);
      return record({
        amount: Number.isFinite(amountCents) ? usd(amountCents) : "invalid",
        dailyCap: usd(DAILY_CAP_USD * 100),
        spentToday: usd(ctx.spentTodayCents),
        remainingToday: usd(remaining),
        withinBudget: Number.isFinite(amountCents) && amountCents <= remaining,
        highValueThreshold: usd(HIGH_VALUE_USD * 100),
      });
    }
    case "compare_market_prices": {
      if (!channel3Enabled()) return record({ available: false });
      const product = matchProduct(String(input.product || ""));
      if (!product) return record({ error: "unknown product", catalog: Object.keys(CATALOG) });
      const { check, offers, error } = await marketCheck(product, usd(CATALOG[product].priceCents));
      ctx.marketCheck = check;
      return record({
        verdict: check.verdict,
        catalogPrice: check.catalogPrice,
        medianMarketPrice: check.medianPrice,
        lowestMarketPrice: check.lowestPrice,
        offerCount: check.offerCount,
        sampleOffers: offers.slice(0, 3).map((o) => ({ title: o.title, merchant: o.merchant, price: o.price.toFixed(2) })),
        ...(error ? { note: error } : {}),
      });
    }
    case "propose_purchase": {
      const product = matchProduct(String(input.product || ""));
      if (!product) return record({ error: "unknown product — choose an exact catalog name", catalog: Object.keys(CATALOG) });
      const quantity = Math.max(1, Math.min(MAX_QUANTITY, Math.floor(Number(input.quantity) || 1)));
      const item = CATALOG[product];

      // Guarantee a real budget check is in the trace even if the model skipped it.
      if (!ctx.trace.some((t) => t.tool === "check_budget")) {
        await runPurchaseTool("check_budget", { amount: usd(item.priceCents * quantity) }, ctx, source);
      }
      const alternatives = Array.isArray(input.alternatives)
        ? input.alternatives
            .map((a: any) => (typeof a === "string" ? a : `${a?.product || "Alternative"} × ${a?.quantity || 1}`))
            .filter(Boolean)
            .slice(0, 4)
        : [];
      ctx.final = {
        product,
        quantity,
        rationale: String(input.rationale || `Reorder ${product}; stock is low.`).slice(0, 600),
        alternatives,
      };
      return record({
        accepted: true,
        product,
        quantity,
        computedAmount: usd(item.priceCents * quantity),
        note: "The backend recomputes the amount from catalog price × quantity.",
      });
    }
    default:
      return record({ error: `unknown tool ${name}` });
  }
}

function finaliseProposal(ctx: PurchaseCtx, mode: Proposal["agentMode"]): Proposal {
  const final = ctx.final!;
  const item = CATALOG[final.product];
  const policyChecks = evaluatePolicy({ unitPriceCents: item.priceCents, quantity: final.quantity, spentTodayCents: ctx.spentTodayCents });
  const computedCents = item.priceCents * final.quantity;
  if (!Number.isFinite(computedCents) || computedCents <= 0 || computedCents > MAX_SINGLE_PURCHASE_USD * 100) {
    throw new Error("Policy rejected the computed amount");
  }
  return {
    product: final.product,
    quantity: final.quantity,
    amount: policyChecks.computedAmount,
    currency: "USD",
    rationale: final.rationale,
    alternatives: final.alternatives,
    toolCalls: ctx.trace,
    agentId: AGENT_ID,
    model: AGENT_MODEL,
    promptHash: promptHash(PURCHASE_SYSTEM),
    policyChecks,
    marketCheck: ctx.marketCheck,
    agentMode: mode,
  };
}

const GENERAL_REQUEST = /\b(low|stock|reorder|restock|running out|what do we need|check)\b/i;

export async function proposePurchase(
  task: string,
  options: { spentTodayCents?: number; inventory: Record<string, number> }
): Promise<Proposal> {
  const ctx: PurchaseCtx = { spentTodayCents: options.spentTodayCents || 0, inventory: options.inventory, trace: [] };
  const user = `Owner request: ${task}
Today's date: ${now().slice(0, 10)}
Today's spend so far: $${usd(ctx.spentTodayCents)} of $${usd(DAILY_CAP_USD * 100)}.
Purchases over $${usd(HIGH_VALUE_USD * 100)} need an extra owner confirmation.
Catalog products: ${Object.keys(CATALOG).join("; ")}.`;

  const mode = await runToolLoop({
    system: PURCHASE_SYSTEM,
    user,
    tools: purchaseTools(),
    run: (name, args) => runPurchaseTool(name, args, ctx, "LLM"),
    done: () => !!ctx.final,
    traceLength: () => ctx.trace.length,
  });
  if (ctx.final && mode) return finaliseProposal(ctx, mode);

  // --- Deterministic fallback, labelled in the trace ---
  const general = GENERAL_REQUEST.test(task);
  const low = lowStock(ctx.inventory);
  if (general || !matchProduct(task)) await runPurchaseTool("get_low_stock_products", {}, ctx, "FALLBACK");
  const product = (!general && matchProduct(task)) || low[0]?.product || "Coffee beans 40lb bag";
  const row = stockRow(product, ctx.inventory);
  await runPurchaseTool("check_inventory", { product }, ctx, "FALLBACK");
  const quantity = Math.max(1, row.suggestedQuantity || 1);
  await runPurchaseTool("check_budget", { amount: usd(CATALOG[product].priceCents * quantity) }, ctx, "FALLBACK");
  if (channel3Enabled()) await runPurchaseTool("compare_market_prices", { product }, ctx, "FALLBACK");
  await runPurchaseTool(
    "propose_purchase",
    {
      product,
      quantity,
      rationale: row.low
        ? `${product} is at ${row.onHand} (reorder point ${row.reorderPoint}), about ${row.daysLeft} day${row.daysLeft === 1 ? "" : "s"} left. Ordering ${quantity} brings it back to the par level of ${row.parLevel}.`
        : `Ordering ${quantity} × ${product} as requested. Stock is ${row.onHand}, above the reorder point.`,
      alternatives: low.filter((r) => r.product !== product).slice(0, 2).map((r) => `${r.product} is also low (${r.onHand} left)`),
    },
    ctx,
    "FALLBACK"
  );
  return finaliseProposal(ctx, "FALLBACK");
}

// ===========================================================================
// Dispute agent
// ===========================================================================

/**
 * Where PayPal's copy of the receipt hash came from. All three are PayPal's own
 * records: the dispute itself, the capture the dispute points at, or the order.
 */
export type PayPalHashOrigin = "DISPUTE" | "CAPTURE" | "ORDER";

export const PAYPAL_HASH_SOURCES = new Set(["PAYPAL_DISPUTE_CUSTOM_ID", "PAYPAL_CAPTURE_CUSTOM_ID", "PAYPAL_ORDER_CUSTOM_ID"]);

export function isPayPalVerifiedSource(source?: string) {
  return !!source && PAYPAL_HASH_SOURCES.has(source);
}

export const HASH_SOURCE_LABEL: Record<string, string> = {
  PAYPAL_DISPUTE_CUSTOM_ID: "PayPal dispute record",
  PAYPAL_CAPTURE_CUSTOM_ID: "PayPal capture record",
  PAYPAL_ORDER_CUSTOM_ID: "PayPal order record",
  STORED_RECEIPT: "RelayPay copy only",
  MISMATCH: "Does not match PayPal",
  NO_RECEIPT: "No receipt linked",
};

export type TimelineEntry = { at: string; actor: string; event: string; detail?: string };

export type PayPalConfirmation = {
  captureId: string;
  status: string;
  amount?: string;
  currency?: string;
  customId?: string;
  createTime?: string;
};

export type DisputeAgentInput = {
  reason: string;
  status: string;
  receiptHash?: string;
  receiptPayload?: IntentReceipt;
  paypalOrderId?: string;
  captureId?: string;
  approvedBy?: string;
  approvedAt?: string;
  product?: string;
  amount?: string;
  vaultApprovedAt?: string;
  /** PayPal's copy of custom_id, read from PayPal (never from a request body). */
  disputeCustomId?: string;
  disputeCustomIdOrigin?: PayPalHashOrigin;
  /** Provenance timeline built from RelayPay's ledger and PayPal webhook events. */
  timeline?: TimelineEntry[];
  /** Re-reads the disputed capture from PayPal. */
  fetchCapture?: () => Promise<PayPalConfirmation | null>;
};

export type DisputeDraft = {
  classification: string;
  draft: string;
  payload: any;
  recommendation: "CONTEST" | "ACCEPT";
  toolCalls: ToolCall[];
  hashVerified: boolean;
  hashSource: string;
  paypalDisputeCustomId?: string;
  paypalConfirmation?: PayPalConfirmation | null;
  timeline: TimelineEntry[];
  overriddenByPolicy: boolean;
  decisionReason: string;
};

const DISPUTE_SYSTEM = `You are the dispute agent for a coffee supplier (the PayPal merchant). The buyer is a cafe customer whose owner approves each order.
Use your tools in this order:
1. get_dispute
2. get_receipt
3. get_event_timeline
4. get_paypal_confirmation
5. verify_hash
6. decide_case
Rules:
- CONTEST only when verify_hash says the hash in PayPal's own record (dispute, capture or order) matches the approved receipt.
- If verify_hash.matches is true and the receipt shows an owner approval before payment, recommend CONTEST.
- Recommend ACCEPT when the hash is missing or does not match.
- "classification" describes the evidence, e.g. "Unauthorized claim — owner approval provenance".
- Use only facts returned by tools. Never invent IDs, dates or delivery details.
- Describe the receipt accurately: it existed before payment, it is unchanged, and PayPal holds the same fingerprint. Never say it proves the payment was authorized or who approved it.
- One-sentence decision reason.`;

const disputeTools = [
  { type: "function", function: { name: "get_dispute", description: "Read the PayPal dispute reason and status.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_receipt", description: "Read the owner-approved intent receipt linked to this payment.", parameters: { type: "object", properties: {} } } },
  {
    type: "function",
    function: {
      name: "get_event_timeline",
      description: "Read the provenance timeline: agent proposal, owner approval, Vault consent, PayPal capture and webhook events.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_paypal_confirmation",
      description: "Re-read the disputed capture from PayPal: status, amount, custom_id and time.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "verify_hash",
      description: "Recompute the SHA-256 receipt hash and compare it with the custom_id PayPal stored for this transaction.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "decide_case",
      description: "Make the final contest-or-refund decision after verifying the evidence.",
      parameters: {
        type: "object",
        properties: {
          recommendation: { type: "string", enum: ["CONTEST", "ACCEPT"] },
          classification: { type: "string" },
          evidenceType: { type: "string", enum: ["PROOF_OF_FULFILLMENT", "PROOF_OF_SHIPMENT", "RECEIPT", "TRACKING_DETAILS", "OTHER"] },
          reason: { type: "string", description: "Why this decision is correct, in one sentence." },
        },
        required: ["recommendation", "classification", "evidenceType", "reason"],
      },
    },
  },
];

type DisputeCtx = {
  input: DisputeAgentInput;
  trace: ToolCall[];
  hashVerified: boolean;
  hashSource: string;
  confirmation?: PayPalConfirmation | null;
  confirmationLoaded: boolean;
  decision?: { recommendation: "CONTEST" | "ACCEPT"; classification: string; evidenceType: string; reason: string };
};

const ALLOWED_EVIDENCE = new Set(["PROOF_OF_FULFILLMENT", "PROOF_OF_SHIPMENT", "RECEIPT", "TRACKING_DETAILS", "OTHER"]);

function verifyDisputeHash(ctx: DisputeCtx) {
  const { receiptPayload, receiptHash, disputeCustomId, disputeCustomIdOrigin } = ctx.input;
  const recomputed = receiptPayload ? hashReceipt(receiptPayload) : null;
  const receiptMatches = !!recomputed && !!receiptHash && recomputed === receiptHash;
  const paypalMatches = disputeCustomId ? disputeCustomId === receiptHash : null;
  const matches = receiptMatches && paypalMatches !== false;
  const origin = disputeCustomIdOrigin || "DISPUTE";
  return {
    receiptHash: receiptHash || null,
    recomputedHash: recomputed,
    paypalCustomId: disputeCustomId || null,
    paypalRecord: disputeCustomId ? origin.toLowerCase() : null,
    receiptMatches,
    paypalMatches,
    matches,
    source: disputeCustomId ? (matches ? `PAYPAL_${origin}_CUSTOM_ID` : "MISMATCH") : receiptMatches ? "STORED_RECEIPT" : "NO_RECEIPT",
  };
}

async function loadConfirmation(ctx: DisputeCtx) {
  if (!ctx.confirmationLoaded) {
    ctx.confirmationLoaded = true;
    try {
      ctx.confirmation = ctx.input.fetchCapture ? await ctx.input.fetchCapture() : null;
    } catch {
      ctx.confirmation = null;
    }
  }
  return ctx.confirmation;
}

async function runDisputeTool(name: string, args: any, ctx: DisputeCtx, source: TraceSource): Promise<any> {
  const input = args && typeof args === "object" ? args : {};
  const record = (output: any) => {
    ctx.trace.push(trace(name, input, output, source));
    return output;
  };

  switch (name) {
    case "get_dispute":
      return record({ reason: ctx.input.reason, status: ctx.input.status, amount: ctx.input.amount || null });
    case "get_receipt":
      return record({
        found: !!ctx.input.receiptHash,
        product: ctx.input.product || null,
        approvedBy: ctx.input.approvedBy || null,
        approvedAt: ctx.input.approvedAt || null,
        receiptHash: ctx.input.receiptHash || null,
        paypalOrderId: ctx.input.paypalOrderId || null,
        captureId: ctx.input.captureId || null,
      });
    case "get_event_timeline": {
      const entries = (ctx.input.timeline || []).slice(0, 14);
      return record({ count: entries.length, vaultApprovedAt: ctx.input.vaultApprovedAt || null, entries });
    }
    case "get_paypal_confirmation": {
      const c = await loadConfirmation(ctx);
      return record(c ? { found: true, ...c } : { found: false, note: "PayPal did not return the capture" });
    }
    case "verify_hash": {
      const result = verifyDisputeHash(ctx);
      // "Verified" means verified against one of PayPal's own records, not just
      // against the copy stored in RelayPay.
      ctx.hashVerified = result.matches && isPayPalVerifiedSource(result.source);
      ctx.hashSource = result.source;
      return record(result);
    }
    case "decide_case": {
      const recommendation = input.recommendation === "ACCEPT" ? "ACCEPT" : "CONTEST";
      const evidenceType = ALLOWED_EVIDENCE.has(input.evidenceType) ? input.evidenceType : "OTHER";
      ctx.decision = {
        recommendation,
        classification: String(input.classification || "Dispute evidence"),
        evidenceType,
        reason: String(input.reason || ""),
      };
      return record({ accepted: true, recommendation, classification: ctx.decision.classification, evidenceType });
    }
    default:
      return record({ error: `unknown tool ${name}` });
  }
}

function classifyReason(reason: string): { classification: string; evidenceType: string } {
  const r = String(reason || "").toUpperCase();
  if (r === "UNAUTHORISED" || r === "UNAUTHORIZED") return { classification: "Unauthorized claim — owner approval provenance", evidenceType: "OTHER" };
  if (r === "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED")
    return { classification: "Not as described — the approved receipt names the exact catalog product", evidenceType: "OTHER" };
  if (r === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED") return { classification: "Not received — fulfillment evidence", evidenceType: "PROOF_OF_FULFILLMENT" };
  return { classification: "Other reason — receipt and payment provenance", evidenceType: "OTHER" };
}

function fmt(at?: string) {
  if (!at) return "—";
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export async function draftDisputeResponse(dispute: DisputeAgentInput): Promise<DisputeDraft> {
  const ctx: DisputeCtx = { input: dispute, trace: [], hashVerified: false, hashSource: "NO_RECEIPT", confirmationLoaded: false };

  await runToolLoop({
    system: DISPUTE_SYSTEM,
    user: `PayPal dispute reason: ${dispute.reason}. Status: ${dispute.status}.`,
    tools: disputeTools,
    run: (name, args) => runDisputeTool(name, args, ctx, "LLM"),
    done: () => !!ctx.decision,
    traceLength: () => ctx.trace.length,
  });

  // Every evidence tool must have run, whatever the model did. Missing ones run
  // deterministically and are labelled FALLBACK.
  for (const tool of ["get_dispute", "get_receipt", "get_event_timeline", "get_paypal_confirmation", "verify_hash"]) {
    if (!ctx.trace.some((t) => t.tool === tool)) await runDisputeTool(tool, {}, ctx, "FALLBACK");
  }

  const evidenceStrong = ctx.hashVerified && isPayPalVerifiedSource(ctx.hashSource) && !!dispute.approvedBy;
  const fallback = classifyReason(dispute.reason);
  let recommendation: "CONTEST" | "ACCEPT" = ctx.decision?.recommendation || (evidenceStrong ? "CONTEST" : "ACCEPT");
  let overriddenByPolicy = false;

  // Guardrail: never contest unless the hash inside one of PayPal's own records
  // matches the approved receipt. A matching local copy alone is not enough.
  if (!evidenceStrong && recommendation === "CONTEST") {
    recommendation = "ACCEPT";
    overriddenByPolicy = true;
    if (ctx.decision) {
      ctx.decision.recommendation = "ACCEPT";
      ctx.decision.reason =
        ctx.hashSource === "STORED_RECEIPT"
          ? "PayPal's records do not contain the receipt hash, so the approval cannot be proven to PayPal."
          : "The receipt hash does not match PayPal's record, so contesting would likely fail.";
    }
  }
  if (!ctx.decision) {
    ctx.decision = {
      recommendation,
      classification: fallback.classification,
      evidenceType: fallback.evidenceType,
      reason: evidenceStrong
        ? `The receipt hash matches the ${HASH_SOURCE_LABEL[ctx.hashSource] || "PayPal record"}, so the owner's approval can be proven.`
        : "No receipt hash in PayPal's records matches an approved receipt, so contesting would likely fail.",
    };
  }

  const evidenceType = ALLOWED_EVIDENCE.has(ctx.decision.evidenceType) ? ctx.decision.evidenceType : fallback.evidenceType;
  const rawClassification = String(ctx.decision.classification || "").trim();
  const classification =
    rawClassification.length >= 15 && rawClassification.toUpperCase() !== String(dispute.reason).toUpperCase()
      ? rawClassification
      : fallback.classification;

  const verificationLine = isPayPalVerifiedSource(ctx.hashSource)
    ? `The SHA-256 hash in the ${HASH_SOURCE_LABEL[ctx.hashSource]} (custom_id) matches the owner-approved receipt.`
    : ctx.hashSource === "STORED_RECEIPT"
      ? "The receipt hash matches RelayPay's stored receipt, but PayPal returned no custom_id for this transaction."
      : ctx.hashSource === "MISMATCH"
        ? "The custom_id PayPal holds for this transaction does not match the approved receipt."
        : "No approved receipt is linked to this transaction.";

  const c = ctx.confirmation;
  const timeline = (dispute.timeline || []).slice(0, 8);
  const facts = [
    `Dispute reason: ${dispute.reason}`,
    `Product: ${dispute.product || "—"}${dispute.amount ? ` (${dispute.amount} USD)` : ""}`,
    `Buyer saved PayPal for future payments (Vault consent): ${fmt(dispute.vaultApprovedAt)}`,
    `Cafe owner approval: ${dispute.approvedBy || "—"} at ${fmt(dispute.approvedAt)}, before payment`,
    `Receipt hash (SHA-256): ${dispute.receiptHash || "—"}`,
    `PayPal order ${dispute.paypalOrderId || "—"}, capture ${dispute.captureId || "—"}${c ? `, status ${c.status}, ${c.amount || ""} ${c.currency || ""}, ${fmt(c.createTime)}` : ""}`,
    `Hash verification: ${verificationLine}`,
    timeline.length ? `Timeline:\n${timeline.map((t) => `- ${fmt(t.at)} ${t.actor}: ${t.event}${t.detail ? ` (${t.detail})` : ""}`).join("\n")}` : "",
    `Recommendation: ${recommendation} (${ctx.decision.reason || "no reason given"})`,
  ]
    .filter(Boolean)
    .join("\n");

  const llmDraft = await llmText(
    "Write a concise response from the supplier (the merchant) to PayPal in 3-5 sentences using ONLY the facts given. Describe the receipt accurately: its SHA-256 fingerprint was recorded by PayPal with the payment and still matches, so the approval record existed at payment time and has not been altered. Do not claim more than that, and do not invent details. If the recommendation is ACCEPT, say the merchant accepts the claim.",
    facts
  );
  const response = llmDraft
    ? llmDraft
    : recommendation === "CONTEST"
      ? "The buyer saved PayPal with this supplier for future payments, and the cafe owner approved this exact order before it was charged. The approval receipt's SHA-256 fingerprint was recorded by PayPal with the payment (custom_id) and still matches, so the approval record existed when the payment was made and has not been altered since."
      : "The merchant does not have a verified receipt hash for this transaction and accepts the claim.";
  // The response goes first so PayPal's 2,000-character notes limit can only
  // ever trim the supporting facts, never the merchant's actual reply.
  const draft = `Merchant response: ${response}\n\nEvidence:\n${facts}`;

  return {
    classification,
    draft,
    payload: { evidences: [{ evidence_type: evidenceType, notes: draft.slice(0, EVIDENCE_NOTES_LIMIT) }] },
    recommendation,
    toolCalls: ctx.trace,
    hashVerified: ctx.hashVerified,
    hashSource: ctx.hashSource,
    paypalDisputeCustomId: dispute.disputeCustomId,
    paypalConfirmation: ctx.confirmation ?? null,
    timeline: dispute.timeline || [],
    overriddenByPolicy,
    decisionReason: ctx.decision.reason,
  };
}
