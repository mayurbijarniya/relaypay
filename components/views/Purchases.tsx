"use client";

import { useMemo, useState } from "react";
import { AgentTrace, Button, Card, Disclosure, EmptyState, Pill, Segmented, Spinner } from "@/components/ui";
import { ChatHead, Checks, DocMark, Lit, ProductTile, Window, type CheckItem } from "@/components/kit";
import { OrderThread } from "@/components/OrderThread";
import { IconAlert, IconCheck, IconCoffee, IconLock, IconShield, IconSparkle } from "@/components/icons";
import { INTENT_STATUS, agentModeLabel, money, shortId, timeAgo, type AnyRecord } from "@/lib/format";
import type { RelayPay } from "@/components/useRelayPay";

type Filter = "all" | "PROPOSED" | "APPROVED" | "CAPTURED" | "REJECTED";

const RESTOCK_TASK = "Check stock and reorder whatever is running low";

/** Example requests built from the café's live stock: what is low first, then the next item to run out. */
function suggestionsFor(inventory: Array<{ product: string; low: boolean; daysLeft: number; suggestedQuantity: number }>) {
  const byUrgency = [...inventory].sort((a, b) => a.daysLeft - b.daysLeft);
  const low = byUrgency.filter((r) => r.low).map((r) => `We're running low on ${r.product.toLowerCase()}`);
  const next = byUrgency.filter((r) => !r.low).map((r) => `Order ${Math.max(1, r.suggestedQuantity || 1)} × ${r.product} before it runs out`);
  return [RESTOCK_TASK, ...low, ...next].slice(0, 4);
}

function StockWindow({ app }: { app: RelayPay }) {
  const rows = app.data!.inventory;
  const low = rows.filter((r) => r.low);
  return (
    <Window crumb={["Café", "Stock"]} meta={low.length ? `${low.length} low` : "All above reorder point"} className="stock-win">
      <ul className="stock-list k-win__pad">
        {rows.map((r) => {
          const pct = Math.min(100, Math.round((r.onHand / Math.max(1, r.parLevel)) * 100));
          return (
            <li key={r.product} className={r.low ? "low" : ""}>
              <ProductTile name={r.product} />
              <div className="stock-row-main">
                <div className="stock-row-top">
                  <span className="stock-name">{r.product}</span>
                  <span className="stock-count">
                    {r.onHand} / {r.parLevel}
                  </span>
                </div>
                <span className="stock-bar" aria-hidden="true">
                  <span style={{ width: `${pct}%` }} />
                  <i style={{ left: `${Math.min(100, (r.reorderPoint / Math.max(1, r.parLevel)) * 100)}%` }} />
                </span>
                <span className="stock-meta">
                  {r.low ? `Low · about ${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"} left` : `${r.daysLeft} days left`} · {money(r.unitPrice)} each
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="stock-actions">
        <Button size="sm" variant="ghost" loading={app.busy.consume} onClick={() => void app.actions.consumeDay()}>
          Run a café day
        </Button>
        <Button size="sm" variant={low.length ? "primary" : "secondary"} icon={<IconSparkle size={14} />} loading={app.busy.propose} onClick={() => void app.actions.propose(RESTOCK_TASK)}>
          Ask the agent to restock
        </Button>
      </div>
    </Window>
  );
}

export function PurchasesView({ app, openReceipt }: { app: RelayPay; openReceipt: (intent: AnyRecord) => void }) {
  const data = app.data!;
  const suggestions = useMemo(() => suggestionsFor(data.inventory), [data.inventory]);
  const [task, setTask] = useState(RESTOCK_TASK);
  const [filter, setFilter] = useState<Filter>("all");

  const intents = useMemo(() => [...data.intents].reverse(), [data.intents]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of data.intents) c[i.status] = (c[i.status] || 0) + 1;
    return c;
  }, [data.intents]);
  const shown = filter === "all" ? intents : intents.filter((i) => i.status === filter);

  return (
    <div className="stack-lg">
      <div className="purchase-top">
        <Lit tone="sage" className="composer-lit">
          <div className="k-panel composer">
            <ChatHead title="Purchasing agent" status={data.config.llmConfigured ? "Online" : "Offline fallback"} />
            <div className="composer-inner">
              <p className="composer-lead">
                Tell the agent what the café needs. It can only order from your catalog, RelayPay recomputes every price, and nothing is charged until the café approves.
              </p>
              <form
                className="k-chat-input"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (task.trim()) void app.actions.propose(task.trim());
                }}
              >
                <label className="sr-only" htmlFor="task">
                  Request for the purchasing agent
                </label>
                <input id="task" value={task} maxLength={500} onChange={(e) => setTask(e.target.value)} placeholder="e.g. We're almost out of coffee beans" />
                <button type="submit" className="k-send" disabled={!task.trim() || app.busy.propose} aria-label="Ask the agent" title="Ask the agent">
                  {app.busy.propose ? (
                    <Spinner size={14} />
                  ) : (
                    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                      <path d="M8 13V3.5M3.8 7.5 8 3.3l4.2 4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              </form>
              {app.busy.propose && <p className="composer-note composer-note-ok">The agent is checking stock, the budget and the catalog…</p>}
              <div className="chips" aria-label="Example requests">
                {suggestions.map((s) => (
                  <button key={s} type="button" className={`chip ${task === s ? "chip-active" : ""}`} onClick={() => setTask(s)}>
                    {s}
                  </button>
                ))}
              </div>
              {!data.config.llmConfigured && (
                <p className="composer-note">
                  <IconAlert size={14} /> No LLM key is configured, so the agent runs its labelled offline fallback.
                </p>
              )}
              {data.config.channel3 && (
                <p className="composer-note composer-note-ok">
                  <IconCheck size={14} /> Market price check is on: the agent compares supplier prices with live offers from Channel3.
                </p>
              )}
            </div>
          </div>
        </Lit>
        <StockWindow app={app} />
      </div>

      <div className="section-bar">
        <h2 className="section-title">Proposals</h2>
        <Segmented<Filter>
          label="Filter proposals"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: data.intents.length },
            { value: "PROPOSED", label: "Awaiting café", count: counts.PROPOSED || 0 },
            { value: "APPROVED", label: "To charge", count: counts.APPROVED || 0 },
            { value: "CAPTURED", label: "Charged", count: counts.CAPTURED || 0 },
            { value: "REJECTED", label: "Rejected", count: counts.REJECTED || 0 },
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <Card>
          <EmptyState icon={<IconCoffee size={22} />} title={filter === "all" ? "No proposals yet" : "Nothing in this list"}>
            {filter === "all"
              ? "Ask the agent above. It checks the café's stock and budget, then proposes an order for the café to approve."
              : "Try another filter."}
          </EmptyState>
        </Card>
      ) : (
        <div className="stack">
          {shown.map((intent) => (
            <IntentCard key={intent.id} app={app} intent={intent} openReceipt={openReceipt} />
          ))}
        </div>
      )}
    </div>
  );
}

function ruleItems(app: RelayPay, intent: AnyRecord, unit: string): CheckItem[] {
  const checks = intent.policyChecks || {};
  const threshold = money(app.data!.policy.highValueThreshold);
  const items: CheckItem[] = [
    { ok: true, label: `Catalog price ${money(unit)} × ${intent.quantity}`, detail: "Recomputed by RelayPay, not set by the agent" },
    checks.withinDailyCap === false
      ? { ok: false, label: "Over the café's daily limit", detail: `${money(checks.remainingToday)} left today` }
      : { ok: true, label: "Within the café's daily limit", detail: checks.remainingToday ? `${money(checks.remainingToday)} left today` : undefined },
    checks.requiresOwnerConfirmation && intent.receiptPayload?.highValueConfirmed
      ? { ok: true, label: `Over ${threshold} · confirmed by the café` }
      : checks.requiresOwnerConfirmation
        ? { ok: null, label: `Over ${threshold} · needs the café's extra tick` }
        : { ok: true, label: `Under the ${threshold} high-value limit` },
  ];
  const m = intent.marketCheck;
  if (m) {
    if (m.verdict === "NO_DATA") items.push({ ok: null, label: "Market check: no live offers found", detail: "Channel3" });
    else
      items.push({
        // Advice, not a rule: above market is shown for the café to weigh, never as a failure.
        ok: m.verdict === "ABOVE_MARKET" ? null : true,
        label: `Supplier price ${m.verdict === "BELOW_MARKET" ? "below" : m.verdict === "ABOVE_MARKET" ? "above" : "at"} market`,
        detail: `Median ${money(m.medianPrice)} across ${m.offerCount} offers (Channel3)`,
      });
  }
  return items;
}

function IntentCard({ app, intent, openReceipt }: { app: RelayPay; intent: AnyRecord; openReceipt: (i: AnyRecord) => void }) {
  const status = INTENT_STATUS[intent.status] || { label: intent.status, tone: "neutral" as const };
  const checks = intent.policyChecks || {};
  const order = app.ordersByIntent[intent.id];
  const verified = app.isVerified(order);
  const unit = checks.catalogPrice || (Number(intent.amount) / Number(intent.quantity || 1)).toFixed(2);

  return (
    <article className={`intent intent-${String(intent.status).toLowerCase()}`}>
      <div className="intent-top">
        <ProductTile name={intent.product} size="lg" />
        <div className="intent-title">
          <h3>{intent.product}</h3>
          <p>
            {intent.quantity} × {money(unit)} · proposed {timeAgo(intent.createdAt)}
          </p>
        </div>
        <div className="intent-amount">
          <strong>{money(intent.amount)}</strong>
          <Pill tone={status.tone}>{status.label}</Pill>
        </div>
      </div>

      <div className="intent-grid">
        <div className="intent-thread">
          <OrderThread app={app} intent={intent} openReceipt={openReceipt} />
        </div>
        <div className="intent-side">
          <Checks title="Café rules" items={ruleItems(app, intent, unit)} right={<span className="k-meta">{checks.policyVersion || "policy"}</span>} />
          {intent.receiptHash && (
            <div className="sealed-strip">
              <IconLock size={15} />
              <span>
                Sealed by <strong>{intent.approvedBy}</strong> · fingerprint <DocMark mono>{shortId(intent.receiptHash, 10, 6)}</DocMark>
              </span>
              {verified && (
                <Pill tone="ok" icon={<IconShield size={12} />}>
                  Verified with PayPal
                </Pill>
              )}
            </div>
          )}
        </div>
      </div>

      <Disclosure
        summary={
          <>
            How the agent decided
            <span className="disclosure-meta">
              {intent.toolCalls?.length || 0} tool calls · {agentModeLabel(intent.agentMode)}
            </span>
          </>
        }
      >
        <AgentTrace calls={intent.toolCalls} />
        {intent.alternatives?.length > 0 && (
          <div className="alternatives">
            <span>Alternatives it considered</span>
            <ul>
              {intent.alternatives.map((a: string) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        )}
      </Disclosure>
    </article>
  );
}
