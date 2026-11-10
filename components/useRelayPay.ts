"use client";

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConfirmRequest, Toast } from "@/components/ui";
import { money, reasonLabel, shortId, type AnyRecord, type Tone } from "@/lib/format";

export type StockRow = {
  product: string;
  unitPrice: string;
  onHand: number;
  reorderPoint: number;
  parLevel: number;
  dailyUsage: number;
  daysLeft: number;
  low: boolean;
  suggestedQuantity: number;
};

export type AppData = {
  intents: AnyRecord[];
  orders: AnyRecord[];
  disputes: AnyRecord[];
  events: AnyRecord[];
  ledger: AnyRecord[];
  vault: { active: boolean; status: string; approvedAt?: string; vaultIdPreview?: string; pendingSetupToken?: boolean; approveLink?: string };
  inventory: StockRow[];
  storage: "postgres" | "file";
  config: {
    paypalConfigured: boolean;
    environment: string;
    sandbox: boolean;
    llmConfigured: boolean;
    model: string;
    agentId: string;
    webhookConfigured: boolean;
    simulatorEnabled: boolean;
    vaultResetAllowed: boolean;
    sandboxBuyerConfigured: boolean;
    channel3: boolean;
    zapier: boolean;
    reconcileEnabled: boolean;
  };
  policy: { version: string; dailyCap: string; highValueThreshold: string; maxQuantity: number; spentToday: string; remainingToday: string };
};

class RequestError extends Error {
  status: number;
  body: AnyRecord;
  constructor(message: string, status: number, body: AnyRecord) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request(url: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...init });
  } catch {
    throw new RequestError("Can't reach RelayPay. Check your connection and try again.", 0, {});
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json?.error) throw new RequestError(json?.error || `Request failed (${response.status})`, response.status, json);
  return json;
}

const post = (url: string, body: AnyRecord = {}) =>
  request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function useRelayPay() {
  const [data, setData] = useState<AppData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [verifications, setVerifications] = useState<Record<string, AnyRecord>>({});
  const [vaultLink, setVaultLink] = useState("");
  const toastId = useRef(0);

  const toast = useCallback((tone: Tone, title: string, body?: string) => {
    const id = ++toastId.current;
    setToasts((list) => [...list.slice(-3), { id, tone, title, body }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === "bad" ? 10_000 : 5500);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const refresh = useCallback(async () => {
    try {
      setData(await request("/api/ledger"));
      setLoadError("");
    } catch (e: any) {
      setLoadError(e?.message || "RelayPay couldn't load its data.");
    }
  }, []);

  // Poll while the tab is visible; refresh immediately when it becomes visible.
  useEffect(() => {
    refresh();
    const timer = setInterval(() => document.visibilityState === "visible" && refresh(), 12_000);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // PayPal sends the buyer back with ?vault=ready|cancelled|missing|failed.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const state = params.get("vault");
    if (!state) return;
    if (state === "ready") toast("ok", "PayPal Vault is connected", "Approved orders can now be charged without a redirect.");
    if (state === "cancelled") toast("warn", "Vault approval was cancelled", "No payment method was saved.");
    if (state === "missing") toast("warn", "PayPal didn't return a setup token", "Create a new approval link and try again.");
    if (state === "failed") toast("bad", "Vault setup didn't finish", params.get("reason") || "Create a new approval link and try again.");
    params.delete("vault");
    params.delete("reason");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }, [toast]);

  /** Run an action with a per-button busy flag and a readable error toast. */
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy((b) => ({ ...b, [key]: true }));
      try {
        return await fn();
      } catch (e: any) {
        const steps: string[] | undefined = e?.body?.manualSteps;
        toast("bad", "That didn't work", [e?.message, steps?.length ? `\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}` : ""].join(""));
        await refresh();
        return undefined;
      } finally {
        setBusy((b) => {
          const next = { ...b };
          delete next[key];
          return next;
        });
      }
    },
    [toast, refresh]
  );

  const ordersByIntent = useMemo(() => {
    const map: Record<string, AnyRecord> = {};
    for (const order of data?.orders || []) {
      const current = map[order.intentId];
      if (!current || (order.status === "COMPLETED" && current.status !== "COMPLETED")) map[order.intentId] = order;
    }
    return map;
  }, [data?.orders]);

  const intentsById = useMemo(() => {
    const map: Record<string, AnyRecord> = {};
    for (const intent of data?.intents || []) map[intent.id] = intent;
    return map;
  }, [data?.intents]);

  const latestCapture = useMemo(() => [...(data?.orders || [])].reverse().find((o) => o.status === "COMPLETED" && o.captureId), [data?.orders]);

  const isVerified = useCallback(
    (order?: AnyRecord) => {
      if (!order) return false;
      const local = verifications[order.id];
      if (local) return local.verified === true;
      return order.verificationSource === "PAYPAL_CUSTOM_ID";
    },
    [verifications]
  );

  // ----- Purchases -----------------------------------------------------------

  const announceProposal = useCallback(
    (i: AnyRecord) =>
      toast("ok", `Agent proposed ${i.quantity} × ${i.product}`, `${money(i.amount)} · ${i.toolCalls?.length || 0} tool calls · waiting for the café's approval`),
    [toast]
  );

  const propose = useCallback(
    (task: string) =>
      run("propose", async () => {
        const { intent } = await post("/api/intents/propose", { task });
        announceProposal(intent);
        await refresh();
        return intent;
      }),
    [run, refresh, announceProposal]
  );

  const proposeDemo = useCallback(
    () =>
      run("demo", async () => {
        const { intent } = await post("/api/judge/run-loop");
        announceProposal(intent);
        await refresh();
        return intent;
      }),
    [run, refresh, announceProposal]
  );

  const consumeDay = useCallback(
    () =>
      run("consume", async () => {
        const result = await post("/api/inventory/consume");
        toast(
          result.low?.length ? "warn" : "ok",
          "A café day went by",
          result.low?.length ? `Running low: ${result.low.join(", ")}. Ask the agent to reorder.` : "Stock is still above every reorder point."
        );
        await refresh();
      }),
    [run, toast, refresh]
  );

  const doApprove = useCallback(
    (intent: AnyRecord, confirmHighValue: boolean) =>
      run(`approve:${intent.id}`, async () => {
        const result = await post(`/api/intents/${intent.id}/approve`, { approvedBy: "cafe-owner", confirmHighValue });
        toast("ok", "Receipt sealed", `Hash ${shortId(result.intent.receiptHash, 10, 6)} will travel with the PayPal payment.`);
        await refresh();
        return result.intent;
      }),
    [run, toast, refresh]
  );

  const approve = useCallback(
    (intent: AnyRecord) => {
      const checks = intent.policyChecks || {};
      if (checks.withinDailyCap === false) {
        toast("bad", "Over the café's daily cap", `Only ${money(checks.remainingToday)} of ${money(checks.dailyCap)} is left today.`);
        return;
      }
      if (checks.requiresOwnerConfirmation) {
        setConfirm({
          title: `Approve a ${money(intent.amount)} purchase?`,
          body: createElement(
            "p",
            null,
            `This is above the café's ${money(data?.policy?.highValueThreshold || 100)} high-value limit. The café owner's confirmation is sealed into the approval receipt.`
          ),
          acknowledge: "I confirm this high-value purchase",
          confirmLabel: "Approve and seal receipt",
          onConfirm: () => void doApprove(intent, true),
        });
        return;
      }
      void doApprove(intent, false);
    },
    [data?.policy?.highValueThreshold, doApprove, toast]
  );

  const reject = useCallback(
    (intent: AnyRecord) =>
      run(`reject:${intent.id}`, async () => {
        await post(`/api/intents/${intent.id}/reject`);
        toast("neutral", "The café rejected the proposal", `${intent.product} won't be ordered.`);
        await refresh();
      }),
    [run, toast, refresh]
  );

  const capture = useCallback(
    (intent: AnyRecord) =>
      run(`capture:${intent.id}`, async () => {
        const result = await post("/api/orders/create", { intentId: intent.id });
        if (result.captured) toast("ok", `Charged ${money(intent.amount)} through PayPal`, `Capture ${shortId(result.order.captureId, 6, 4)} · stock updated`);
        else toast("warn", "PayPal order created, not captured yet", result.warning);
        await refresh();
        return result;
      }),
    [run, toast, refresh]
  );

  const verify = useCallback(
    (order: AnyRecord) =>
      run(`verify:${order.id}`, async () => {
        const result = await request(`/api/orders/${order.id}/verify`);
        setVerifications((v) => ({ ...v, [order.id]: result }));
        if (result.verified) toast("ok", "Verified with PayPal", "PayPal's custom_id matches the café's approval receipt.");
        else toast("bad", "Verification failed", result.message);
        await refresh();
        return result;
      }),
    [run, toast, refresh]
  );

  const reconcile = useCallback(
    () =>
      run("reconcile", async () => {
        const r = await post("/api/orders/reconcile");
        toast(
          r.pending ? "neutral" : "ok",
          "Reconciled with PayPal",
          r.checked
            ? `${r.confirmed} of ${r.checked} payments found in PayPal's reporting ledger${r.pending ? `. ${r.pending} not indexed yet; PayPal can take a few hours.` : "."}`
            : "No captured payments to check yet."
        );
        await refresh();
      }),
    [run, toast, refresh]
  );

  // ----- Disputes ------------------------------------------------------------

  const announceDraft = useCallback(
    (d: AnyRecord) =>
      toast(
        d.agentRecommendation === "CONTEST" ? "ok" : "warn",
        d.agentRecommendation === "CONTEST" ? "Agent recommends contesting" : "Agent recommends a refund",
        d.agentDecisionReason
      ),
    [toast]
  );

  const draftSample = useCallback(
    (reason = "UNAUTHORISED") =>
      run("draft-sample", async () => {
        if (!latestCapture) throw new Error("Charge an order first. The sample dispute links to a real PayPal capture.");
        const { dispute } = await post("/api/disputes/simulated/draft", { reason, captureId: latestCapture.captureId, paypalOrderId: latestCapture.paypalOrderId });
        announceDraft(dispute);
        await refresh();
        return dispute;
      }),
    [run, refresh, latestCapture, announceDraft]
  );

  const draftReal = useCallback(
    (disputeId: string) =>
      run("draft-real", async () => {
        const id = disputeId.trim().toUpperCase();
        if (!id) throw new Error("Paste the PayPal dispute ID first (it starts with PP-D- or PP-R-).");
        const { dispute } = await post(`/api/disputes/${encodeURIComponent(id)}/draft`);
        toast("ok", `Imported ${id}`, `${reasonLabel(dispute.reason)} · agent recommends ${dispute.agentRecommendation === "CONTEST" ? "contesting" : "a refund"}`);
        await refresh();
        return dispute;
      }),
    [run, toast, refresh]
  );

  const syncDisputes = useCallback(
    () =>
      run("sync", async () => {
        const r = await post("/api/disputes/sync");
        toast(
          r.imported?.length ? "ok" : "neutral",
          r.imported?.length ? `Imported ${r.imported.length} new dispute${r.imported.length === 1 ? "" : "s"}` : "No new disputes for RelayPay payments",
          `${r.found} on PayPal · ${r.refreshed} refreshed${r.unrelated ? ` · ${r.unrelated} for other payments` : ""}${r.more ? " · run again for more" : ""}`
        );
        await refresh();
      }),
    [run, toast, refresh]
  );

  const advanceDispute = useCallback(
    (dispute: AnyRecord) =>
      run(`advance:${dispute.id}`, async () => {
        const r = await post(`/api/disputes/${dispute.id}/advance`);
        toast(r.ready ? "ok" : "neutral", r.ready ? "PayPal is waiting for your evidence" : "Dispute moved forward", r.message);
        await refresh();
      }),
    [run, toast, refresh]
  );

  const openSandboxDispute = useCallback(
    (order: AnyRecord, buyerTransactionId: string, reason: string) =>
      run(`open-dispute:${order.id}`, async () => {
        const r = await post("/api/disputes/open-sandbox", { orderId: order.id, buyerTransactionId, reason });
        toast("ok", "Sandbox dispute opened", r.dispute ? `${r.disputeId} imported · agent recommends ${r.dispute.agentRecommendation === "CONTEST" ? "contesting" : "a refund"}` : r.note);
        await refresh();
        return r;
      }),
    [run, toast, refresh]
  );

  const approveDispute = useCallback(
    (dispute: AnyRecord) =>
      run(`dapprove:${dispute.id}`, async () => {
        await post(`/api/disputes/${dispute.id}/approve`);
        toast("ok", "Response approved", "Nothing has been sent yet. Choose what to send to PayPal.");
        await refresh();
      }),
    [run, toast, refresh]
  );

  const submitDispute = useCallback(
    (dispute: AnyRecord) =>
      setConfirm({
        title: "Send this evidence to PayPal?",
        body: createElement(
          "p",
          null,
          "RelayPay re-checks the receipt hash against PayPal one last time, then submits the response and the evidence PDF. PayPal accepts evidence for a dispute only once."
        ),
        acknowledge: "I understand evidence can only be submitted once",
        confirmLabel: "Send evidence",
        tone: "success",
        onConfirm: () =>
          void run(`dsubmit:${dispute.id}`, async () => {
            await post(`/api/disputes/${dispute.id}/submit`);
            toast("ok", "Evidence sent to PayPal", "The response and the evidence PDF are now on the dispute.");
            await refresh();
          }),
      }),
    [run, toast, refresh]
  );

  const acceptDispute = useCallback(
    (dispute: AnyRecord) =>
      setConfirm({
        title: "Refund the café?",
        body: createElement("p", null, "Accepting the claim closes the dispute in the café's favour and PayPal refunds them. This can't be undone."),
        acknowledge: "I understand this refunds the café and can't be undone",
        confirmLabel: "Accept claim and refund",
        tone: "danger",
        onConfirm: () =>
          void run(`daccept:${dispute.id}`, async () => {
            await post(`/api/disputes/${dispute.id}/accept-claim`);
            toast("neutral", "Claim accepted", "PayPal will refund the café.");
            await refresh();
          }),
      }),
    [run, toast, refresh]
  );

  // ----- Vault & settings ----------------------------------------------------

  const vaultSetup = useCallback(
    () =>
      run("vault-setup", async () => {
        const result = await post("/api/vault/setup-token");
        setVaultLink(result.approveLink || "");
        toast("ok", "Approval link ready", "Open it and log in as the café (your PayPal sandbox buyer account).");
        await refresh();
        return result;
      }),
    [run, toast, refresh]
  );

  const vaultExchange = useCallback(
    () =>
      run("vault-exchange", async () => {
        await post("/api/vault/exchange");
        setVaultLink("");
        toast("ok", "PayPal Vault is connected", "Approved orders can now be charged without a redirect.");
        await refresh();
      }),
    [run, toast, refresh]
  );

  const testNotification = useCallback(
    () =>
      run("notify-test", async () => {
        await post("/api/notify/test");
        toast("ok", "Test notification sent", "Check the Zap you connected (email, SMS or Slack).");
        await refresh();
      }),
    [run, toast, refresh]
  );

  return {
    data,
    loadError,
    busy,
    toasts,
    dismissToast,
    confirm,
    closeConfirm: useCallback(() => setConfirm(null), []),
    verifications,
    // The link survives a reload because the server keeps it while approval is pending.
    vaultLink: vaultLink || data?.vault.approveLink || "",
    ordersByIntent,
    intentsById,
    latestCapture,
    isVerified,
    actions: {
      refresh: () => run("refresh", refresh),
      propose,
      proposeDemo,
      consumeDay,
      approve,
      reject,
      capture,
      verify,
      reconcile,
      draftSample,
      draftReal,
      syncDisputes,
      advanceDispute,
      openSandboxDispute,
      approveDispute,
      submitDispute,
      acceptDispute,
      vaultSetup,
      vaultExchange,
      testNotification,
    },
  };
}

export type RelayPay = ReturnType<typeof useRelayPay>;
