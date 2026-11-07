"use client";

import { Button } from "@/components/ui";
import { ChatActions, Chat, MsgBot, MsgMe, ToolLine } from "@/components/kit";
import { IconCard, IconCheck, IconReceipt, IconShield, IconX } from "@/components/icons";
import { money, type AnyRecord } from "@/lib/format";
import type { RelayPay } from "@/components/useRelayPay";

const CHECKED: Record<string, string> = {
  get_low_stock_products: "stock",
  check_inventory: "stock",
  check_budget: "today's budget",
  search_catalog: "the catalog price",
  compare_market_prices: "market prices (Channel3)",
};

/** "Checked stock, today's budget and the catalog price", from the tools the agent really called. */
export function toolSummary(calls: AnyRecord[] | undefined) {
  const parts: string[] = [];
  for (const c of calls || []) {
    const p = CHECKED[c?.tool];
    if (p && !parts.includes(p)) parts.push(p);
  }
  if (!parts.length) return "Read the request";
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `Checked ${list}`;
}

/** The order as the landing hero shows it: the request, what the agent checked, its proposal, then the café's buttons. */
export function OrderThread({
  app,
  intent,
  openReceipt,
}: {
  app: RelayPay;
  intent: AnyRecord;
  openReceipt?: (intent: AnyRecord) => void;
}) {
  const calls: AnyRecord[] = intent.toolCalls || [];
  const fallback = intent.agentMode === "FALLBACK";
  const order = app.ordersByIntent[intent.id];
  const verified = app.isVerified(order);
  const vaultReady = app.data!.vault.active;

  return (
    <Chat>
      <MsgMe>{intent.task || "Check stock and reorder whatever is running low"}</MsgMe>
      <ToolLine warn={fallback}>
        {toolSummary(calls)}
        {fallback ? " · offline fallback" : ""}
      </ToolLine>
      <MsgBot note={`${calls.length} tool call${calls.length === 1 ? "" : "s"}`}>
        {intent.rationale || (
          <>
            {intent.quantity} × {intent.product} for <b>{money(intent.amount)}</b>.
          </>
        )}
      </MsgBot>
      <ChatActions>
        {intent.status === "PROPOSED" && (
          <>
            <Button variant="primary" icon={<IconCheck size={15} />} loading={app.busy[`approve:${intent.id}`]} onClick={() => app.actions.approve(intent)}>
              Café approves · {money(intent.amount)}
            </Button>
            <Button variant="secondary" icon={<IconX size={15} />} loading={app.busy[`reject:${intent.id}`]} onClick={() => void app.actions.reject(intent)}>
              Reject
            </Button>
          </>
        )}
        {intent.status === "APPROVED" && (
          <>
            <Button
              variant="primary"
              icon={<IconCard size={15} />}
              loading={app.busy[`capture:${intent.id}`]}
              disabled={!vaultReady}
              title={vaultReady ? undefined : "Connect PayPal Vault in Settings first"}
              onClick={() => void app.actions.capture(intent)}
            >
              Charge {money(intent.amount)} with PayPal
            </Button>
            {openReceipt && (
              <Button variant="secondary" icon={<IconReceipt size={15} />} onClick={() => openReceipt(intent)}>
                View receipt
              </Button>
            )}
            {!vaultReady && <span className="action-hint">The café hasn&apos;t saved its PayPal yet (Settings).</span>}
          </>
        )}
        {intent.status === "CAPTURED" && (
          <>
            {order && (
              <Button
                variant={verified ? "secondary" : "primary"}
                icon={<IconShield size={15} />}
                loading={app.busy[`verify:${order.id}`]}
                onClick={() => void app.actions.verify(order)}
              >
                {verified ? "Verify again" : "Verify with PayPal"}
              </Button>
            )}
            {openReceipt && (
              <Button variant="secondary" icon={<IconReceipt size={15} />} onClick={() => openReceipt(intent)}>
                View receipt
              </Button>
            )}
            {verified && (
              <span className="action-hint">
                <IconShield size={14} /> Matches PayPal&apos;s copy
              </span>
            )}
          </>
        )}
        {intent.status === "REJECTED" && <span className="action-hint">The café rejected this. Nothing was charged.</span>}
      </ChatActions>
    </Chat>
  );
}
