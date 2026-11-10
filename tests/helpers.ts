import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Test harness: an isolated working directory (file storage never touches the
 * repo), test credentials, and a fake network that stands in for PayPal and the
 * LLM. Call setupEnv() BEFORE importing any app module: lib/env.ts and
 * lib/store.ts read the environment and cwd when they load.
 */
export function setupEnv(extra: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relaypay-test-"));
  process.chdir(dir);
  Object.assign(process.env, {
    PAYPAL_CLIENT_ID: "test-client",
    PAYPAL_CLIENT_SECRET: "test-secret",
    PAYPAL_ENVIRONMENT: "sandbox",
    PAYPAL_WEBHOOK_ID: "WH-TEST",
    DATABASE_URL: "",
    LLM_API_KEY: "",
    CHANNEL3_API_KEY: "",
    ZAPIER_WEBHOOK_URL: "",
    ALLOW_SIMULATOR: "false",
    DISABLE_RATE_LIMITS: "true",
    ...extra,
  });
  return dir;
}

export type Call = { method: string; host: string; path: string; headers: Record<string, string>; body: any };

type Cfg = {
  /** Status PayPal returns when an order is created with a vault_id. */
  createStatus: "APPROVED" | "COMPLETED";
  tamperCustomId: boolean;
  tamperAmount: boolean;
  /** Status of the capture PayPal creates. */
  captureStatus: string;
  /** Capture succeeds at PayPal but the response is a 500. */
  captureThrows: boolean;
  webhookValid: boolean;
  /** Every request hangs until its AbortSignal fires. */
  hang: boolean;
  /** Scripted LLM replies (chat completion `message` objects), consumed in order. */
  llm: any[];
  disputeStatus: string;
  disputeCustomOnDispute: string | undefined;
  /** custom_id PayPal's capture record reports. Defaults to the order's custom_id. */
  captureCustomId: string | undefined;
};

export function installFakeNetwork() {
  const calls: Call[] = [];
  const orders = new Map<string, any>();
  const byRequestId = new Map<string, string>();
  const evidenceSubmissions: any[] = [];
  const cfg: Cfg = {
    createStatus: "APPROVED",
    tamperCustomId: false,
    tamperAmount: false,
    captureStatus: "COMPLETED",
    captureThrows: false,
    webhookValid: true,
    hang: false,
    llm: [],
    disputeStatus: "WAITING_FOR_SELLER_RESPONSE",
    disputeCustomOnDispute: undefined,
    captureCustomId: undefined,
  };
  let n = 0;
  const realFetch = globalThis.fetch;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    let body: any = init.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        /* keep the string */
      }
    }
    const call: Call = { method: init.method || "GET", host: url.host, path: url.pathname, headers, body };
    calls.push(call);

    if (cfg.hang) {
      // AbortSignal.timeout() is unref'd, so hold the event loop open like a real socket would.
      // Capped, so a missing timeout shows up as a failure instead of hanging the run.
      const keepAlive = setTimeout(() => {}, 4000);
      return new Promise<Response>((_, reject) => {
        init.signal?.addEventListener("abort", () => {
          clearTimeout(keepAlive);
          reject(Object.assign(new Error("The operation timed out."), { name: "TimeoutError" }));
        });
      });
    }

    // --- LLM ---------------------------------------------------------------
    if (url.host === "api.subconscious.dev") {
      const message = cfg.llm.shift();
      if (message?.__status) return json(message.__status, { error: "scripted failure" });
      return message ? json(200, { choices: [{ message }] }) : json(500, { error: "no scripted reply" });
    }

    if (!url.host.endsWith("paypal.com")) throw new Error(`Unexpected network call to ${url.host}${url.pathname}`);

    // --- PayPal ------------------------------------------------------------
    if (url.pathname === "/v1/oauth2/token") return json(200, { access_token: "tok", expires_in: 32000 });

    if (url.pathname === "/v1/notifications/verify-webhook-signature") {
      return json(200, { verification_status: cfg.webhookValid ? "SUCCESS" : "FAILURE" });
    }

    if (url.pathname === "/v2/checkout/orders" && call.method === "POST") {
      const rid = headers["paypal-request-id"];
      const existing = rid ? byRequestId.get(rid) : undefined;
      if (existing) return json(200, orders.get(existing));
      const unit = body.purchase_units[0];
      const id = `ORD-${++n}`;
      const completed = cfg.createStatus === "COMPLETED";
      const order: any = {
        id,
        status: cfg.createStatus,
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: { currency_code: unit.amount.currency_code, value: cfg.tamperAmount ? "1.00" : unit.amount.value },
            custom_id: cfg.tamperCustomId ? "f".repeat(64) : unit.custom_id,
            ...(completed ? { payments: { captures: [{ id: `CAP-${id}`, status: cfg.captureStatus }] } } : {}),
          },
        ],
        links: completed ? [] : [{ rel: "capture", href: `https://api-m.sandbox.paypal.com/v2/checkout/orders/${id}/capture`, method: "POST" }],
      };
      orders.set(id, order);
      if (rid) byRequestId.set(rid, id);
      return json(201, order);
    }

    const orderMatch = url.pathname.match(/^\/v2\/checkout\/orders\/([^/]+)(\/capture)?$/);
    if (orderMatch) {
      const order = orders.get(orderMatch[1]);
      if (!order) return json(404, { name: "RESOURCE_NOT_FOUND" });
      if (!orderMatch[2]) return json(200, order);
      // capture
      if (order.status === "COMPLETED" && order.purchase_units[0].payments) return json(200, order);
      order.status = "COMPLETED";
      order.purchase_units[0].payments = { captures: [{ id: `CAP-${order.id}`, status: cfg.captureStatus }] };
      return cfg.captureThrows ? json(500, { name: "INTERNAL_SERVER_ERROR" }) : json(201, order);
    }

    const captureMatch = url.pathname.match(/^\/v2\/payments\/captures\/([^/]+)$/);
    if (captureMatch) {
      const order = [...orders.values()].find((o) => o.purchase_units[0].payments?.captures?.[0]?.id === captureMatch[1]);
      const unit = order?.purchase_units[0];
      return json(200, {
        id: captureMatch[1],
        status: unit?.payments?.captures?.[0]?.status || "COMPLETED",
        amount: unit?.amount || { currency_code: "USD", value: "0.00" },
        custom_id: cfg.captureCustomId ?? unit?.custom_id,
        create_time: "2026-11-09T12:00:00Z",
      });
    }

    // --- Disputes ----------------------------------------------------------
    const disputeMatch = url.pathname.match(/^\/v1\/customer\/disputes\/([^/]+)(\/provide-evidence)?$/);
    if (disputeMatch) {
      if (disputeMatch[2]) {
        const form = body as FormData;
        evidenceSubmissions.push({ input: JSON.parse(String(form.get("input"))), file: form.get("file1") instanceof Blob });
        return json(200, {});
      }
      const capture = [...orders.values()][0]?.purchase_units?.[0]?.payments?.captures?.[0];
      return json(200, {
        dispute_id: disputeMatch[1],
        reason: "UNAUTHORISED",
        status: cfg.disputeStatus,
        disputed_transactions: [{ seller_transaction_id: capture?.id, buyer_transaction_id: "BUYER-TX", ...(cfg.disputeCustomOnDispute ? { custom: cfg.disputeCustomOnDispute } : {}) }],
        links: [{ rel: "provide-evidence", href: `https://api-m.sandbox.paypal.com/v1/customer/disputes/${disputeMatch[1]}/provide-evidence`, method: "POST" }],
      });
    }

    return json(404, { name: "NOT_FOUND", path: url.pathname });
  }) as typeof fetch;

  const defaults = { ...cfg, llm: [] as any[] };
  return {
    calls,
    orders,
    cfg,
    evidenceSubmissions,
    /** Forget every call and order and restore default behavior. */
    reset: () => {
      calls.length = 0;
      orders.clear();
      byRequestId.clear();
      evidenceSubmissions.length = 0;
      Object.assign(cfg, defaults, { llm: [] });
    },
    count: (pred: (c: Call) => boolean) => calls.filter(pred).length,
    created: () => calls.filter((c) => c.method === "POST" && c.path === "/v2/checkout/orders"),
    captured: () => calls.filter((c) => c.method === "POST" && c.path.endsWith("/capture")),
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

/** Invoke a route handler the way Next does. */
export async function call(handler: (...args: any[]) => Promise<Response>, init: { method?: string; body?: unknown; headers?: Record<string, string>; id?: string; raw?: string } = {}) {
  const req = new Request("http://localhost/test", {
    method: init.method || "POST",
    headers: init.headers,
    body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
  const res = await handler(req, { params: Promise.resolve({ id: init.id || "" }) });
  let json: any = null;
  try {
    json = await res.clone().json();
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, headers: res.headers };
}
