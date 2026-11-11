import { NextResponse } from "next/server";
import { loadDB, storageMode } from "@/lib/store";
import { env, isSandbox } from "@/lib/env";
import { AGENT_ID, AGENT_MODEL } from "@/lib/agents";
import { CATALOG, DAILY_CAP_USD, HIGH_VALUE_USD, MAX_QUANTITY, POLICY_VERSION, spentTodayCents, stockRow, usd } from "@/lib/policy";
import { channel3Enabled } from "@/lib/channel3";
import { alertsChannel, alertsEnabled } from "@/lib/notify";
import { route } from "@/lib/http";
import { canonicalReceipt } from "@/lib/receipts";

export const dynamic = "force-dynamic";

/**
 * The UI's read model. Secrets never leave the server: configuration is
 * reported as booleans, and the Vault token only as a short preview.
 */
export const GET = route(async () => {
  const db = await loadDB();
  const spent = spentTodayCents(db.orders);
  return NextResponse.json({
    // receiptCanonical is the exact text that was SHA-256 hashed, so anyone can re-hash it.
    intents: db.intents.map((i) => (i.receiptPayload ? { ...i, receiptCanonical: canonicalReceipt(i.receiptPayload) } : i)),
    orders: db.orders,
    disputes: db.disputes.map(({ rawDisputeJson, paypalResponse, ...d }) => d),
    events: db.events.slice(-200).map(({ rawPayload, ...e }) => e),
    ledger: db.ledger,
    vault: {
      active: !!db.vault.vaultId,
      status: db.vault.status || (db.vault.vaultId ? "ACTIVE" : "NOT_SET_UP"),
      approvedAt: db.vault.approvedAt,
      vaultIdPreview: db.vault.vaultId ? `${db.vault.vaultId.slice(0, 6)}…` : undefined,
      pendingSetupToken: !!db.vault.setupTokenId,
      approveLink: db.vault.setupTokenId ? db.vault.approveLink : undefined,
    },
    inventory: Object.keys(CATALOG).map((p) => stockRow(p, db.inventory)),
    storage: storageMode(),
    config: {
      paypalConfigured: !!env.paypalClientId && !!env.paypalClientSecret,
      environment: env.paypalEnvironment,
      sandbox: isSandbox(),
      llmConfigured: !!env.llmApiKey,
      model: AGENT_MODEL,
      agentId: AGENT_ID,
      webhookConfigured: !!process.env.PAYPAL_WEBHOOK_ID,
      simulatorEnabled: process.env.ALLOW_SIMULATOR === "true",
      vaultResetAllowed: process.env.ALLOW_VAULT_RESET === "true",
      sandboxBuyerConfigured: !!env.sandboxBuyerEmail,
      channel3: channel3Enabled(),
      alerts: alertsEnabled(),
      alertsChannel: alertsChannel(),
      reconcileEnabled: process.env.ENABLE_RECONCILE === "true",
      resetEnabled: (process.env.ADMIN_RESET_TOKEN || "").length >= 12,
    },
    policy: {
      version: POLICY_VERSION,
      dailyCap: usd(DAILY_CAP_USD * 100),
      highValueThreshold: usd(HIGH_VALUE_USD * 100),
      maxQuantity: MAX_QUANTITY,
      spentToday: usd(spent),
      remainingToday: usd(Math.max(0, DAILY_CAP_USD * 100 - spent)),
    },
  });
});
