"use client";

import { useState } from "react";
import { Button, Card, CardHeader, EmptyState, Pill } from "@/components/ui";
import { ActorMark, BrandIcon, ChatHead, Lit, ProductTile, Window } from "@/components/kit";
import { OrderThread } from "@/components/OrderThread";
import { IconArrowRight, IconCheck, IconList, IconPlay, IconShield } from "@/components/icons";
import { ACTOR_LABEL, eventLabel, money, timeAgo, type AnyRecord } from "@/lib/format";
import type { RelayPay } from "@/components/useRelayPay";
import type { View } from "@/components/views/types";

function inboxStatus(app: RelayPay, intent: AnyRecord) {
  if (intent.status === "PROPOSED") return "Awaiting café approval";
  if (intent.status === "APPROVED") return "Approved · ready to charge";
  if (intent.status === "REJECTED") return "Rejected by the café";
  if (intent.status === "CAPTURED") return app.isVerified(app.ordersByIntent[intent.id]) ? "Verified with PayPal" : "Charged with PayPal";
  return String(intent.status || "").toLowerCase();
}

/** The landing hero, live: the café's recent orders beside the agent's conversation for one of them. */
function OrderWindow({ app, go, openReceipt }: { app: RelayPay; go: (v: View) => void; openReceipt: (i: AnyRecord) => void }) {
  const data = app.data!;
  const recent = [...data.intents].reverse().slice(0, 5);
  const waiting = recent.find((i) => i.status === "PROPOSED") || recent.find((i) => i.status === "APPROVED");
  const [picked, setPicked] = useState<string | null>(null);
  const current = recent.find((i) => i.id === picked) || waiting || recent[0];

  return (
    <Window
      crumb={["Purchases", "Café reorder"]}
      meta={
        <>
          <BrandIcon name="paypal" size={13} />
          {data.vault.active ? "Vault connected" : "Vault not connected"} · {data.config.sandbox === false ? "live" : "sandbox"}
        </>
      }
    >
      <div className="k-orderwin__body">
        <div className="k-inbox" role="list" aria-label="Recent orders">
          <div className="k-inbox__q">Orders</div>
          {recent.length === 0 && <p className="k-inbox__empty">No orders yet.</p>}
          {recent.map((i) => (
            <button
              key={i.id}
              type="button"
              role="listitem"
              className={`k-inbox__row ${current?.id === i.id ? "is-on" : ""}`.trim()}
              aria-current={current?.id === i.id ? "true" : undefined}
              onClick={() => setPicked(i.id)}
            >
              <ProductTile name={i.product} />
              <b>{i.product}</b>
              <time>{money(i.amount)}</time>
              <span>{inboxStatus(app, i)}</span>
            </button>
          ))}
        </div>
        <div className="k-orderwin__convo">
          <ChatHead title="Purchasing agent" status={data.config.llmConfigured ? "Online" : "Offline fallback"} />
          {current ? (
            <OrderThread app={app} intent={current} openReceipt={openReceipt} />
          ) : (
            <div className="k-orderwin__empty">
              <p>Ask the agent to check the café&apos;s stock. It proposes an order, and nothing is charged until the café approves.</p>
              <Button variant="primary" icon={<IconPlay size={14} />} loading={app.busy.demo} onClick={() => void app.actions.proposeDemo()}>
                Run the purchasing agent
              </Button>
            </div>
          )}
          {current && (
            <div className="k-orderwin__more">
              <button type="button" className="link" onClick={() => go("purchases")}>
                All purchases
              </button>
            </div>
          )}
        </div>
      </div>
    </Window>
  );
}

type Step = {
  key: string;
  title: string;
  body: string;
  done: boolean;
  result?: string;
  action?: { label: string; run: () => void; busyKey?: string; disabledReason?: string };
  /** Where to do this step when its button already lives in the order window. */
  pointer?: string;
};

export function OverviewView({ app, go, openReceipt }: { app: RelayPay; go: (v: View) => void; openReceipt: (i: AnyRecord) => void }) {
  const data = app.data!;
  const intents = data.intents;
  const orders = data.orders;
  const disputes = data.disputes;

  const proposed = intents.filter((i) => i.status === "PROPOSED");
  const approved = intents.filter((i) => i.status === "APPROVED");
  const paidOrders = orders.filter((o) => o.status === "COMPLETED");
  const verifiedOrders = paidOrders.filter((o) => app.isVerified(o));
  const openDisputes = disputes.filter((d) => !d.submitted && !d.resolution);
  const latestIntent = intents[intents.length - 1];
  const latestPaid = paidOrders[paidOrders.length - 1];
  const latestSealed = [...intents].reverse().find((i) => i.receiptHash);

  const steps: Step[] = [
    {
      key: "vault",
      title: "Connect PayPal Vault",
      body: "The café saves its PayPal with you once. After that, orders the café approves can be charged without a redirect.",
      done: data.vault.active,
      result: data.vault.active ? "Payment method saved" : undefined,
      action: { label: "Open Vault setup", run: () => go("settings") },
    },
    {
      key: "propose",
      title: "Let the agent find what the café needs",
      body: "The AI agent finds what's running low, checks stock, the café's budget and (with Channel3) the market price, then proposes an order. It cannot pay.",
      done: intents.length > 0,
      result: latestIntent ? `${latestIntent.quantity} × ${latestIntent.product}` : undefined,
      pointer: "Use “Run the purchasing agent” in the order window, or ask on Purchases.",
    },
    {
      key: "approve",
      title: "The café approves",
      body: "The café owner's approval is sealed into a receipt: what, how much, who and when, fingerprinted with SHA-256.",
      done: intents.some((i) => !!i.receiptHash),
      result: latestSealed ? `Sealed · ${latestSealed.product}` : undefined,
      pointer: "Approve it in the order window.",
    },
    {
      key: "capture",
      title: "Charge through PayPal",
      body: "RelayPay creates the PayPal order with the receipt fingerprint as custom_id and captures it with the café's saved Vault token.",
      done: paidOrders.length > 0,
      result: latestPaid ? `${money(latestPaid.amount)} captured` : undefined,
      pointer: data.vault.active ? "Charge it in the order window." : "Connect PayPal Vault first (step 1), then charge it in the order window.",
    },
    {
      key: "verify",
      title: "Check it against PayPal's copy",
      body: "Re-read the order from PayPal and check that its custom_id still equals the fingerprint of the café's approval receipt.",
      done: verifiedOrders.length > 0,
      result: verifiedOrders.length ? `${verifiedOrders.length} receipt${verifiedOrders.length === 1 ? "" : "s"} verified` : undefined,
      pointer: "Press “Verify with PayPal” in the order window, or on Receipts.",
    },
    {
      key: "dispute",
      title: "Handle a dispute",
      body: "If the café's payment is disputed, the agent checks the receipt against PayPal's copy and drafts your response. You decide what is sent.",
      done: disputes.length > 0,
      result: disputes.length ? `${disputes.length} case${disputes.length === 1 ? "" : "s"} drafted` : undefined,
      action: latestPaid
        ? { label: "Run a sample dispute", run: () => { void app.actions.draftSample(); go("disputes"); }, busyKey: "draft-sample" }
        : { label: "Go to disputes", run: () => go("disputes") },
    },
  ];
  const currentIndex = steps.findIndex((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;

  const activity = [...data.ledger].reverse().slice(0, 8);

  return (
    <div className="stack-lg">
      <div className="stat-grid">
        <Stat
          label="Waiting on action"
          value={String(proposed.length + approved.length)}
          detail={`${proposed.length} for the café · ${approved.length} to charge`}
          tone={proposed.length + approved.length ? "warn" : "neutral"}
        />
        <Stat
          label="Café spend today"
          value={money(data.policy.spentToday)}
          detail={`of ${money(data.policy.dailyCap)} daily cap`}
          meter={Number(data.policy.spentToday) / Number(data.policy.dailyCap || 1)}
        />
        <Stat
          label="Receipts verified"
          value={`${verifiedOrders.length} / ${paidOrders.length}`}
          detail="checked against PayPal custom_id"
          tone={paidOrders.length && verifiedOrders.length === paidOrders.length ? "ok" : "neutral"}
        />
        <Stat
          label="Open disputes"
          value={String(openDisputes.length)}
          detail={openDisputes.length ? "need your decision" : "nothing to handle"}
          tone={openDisputes.length ? "bad" : "neutral"}
        />
      </div>
      <div className="k-hero">
        <Lit tone="land">
          <OrderWindow app={app} go={go} openReceipt={openReceipt} />
        </Lit>
        <div className="stack">
          <Card className="walkthrough">
            <CardHeader
              title="Guided walkthrough"
              subtitle="The full loop in six steps, using the real PayPal sandbox."
              actions={<Pill tone={doneCount === steps.length ? "ok" : "brand"}>{doneCount} of {steps.length} done</Pill>}
            />
            <ol className="stepper">
              {steps.map((step, index) => {
                const state = step.done ? "done" : index === currentIndex ? "current" : "todo";
                return (
                  <li key={step.key} className={`step step-${state}`}>
                    <span className="step-marker" aria-hidden="true">
                      {step.done ? <IconCheck size={14} /> : index + 1}
                    </span>
                    <div className="step-content">
                      <div className="step-title-row">
                        <h3 className="step-title">{step.title}</h3>
                        {step.done && step.result && <span className="step-result">{step.result}</span>}
                      </div>
                      {state === "current" && (
                        <>
                          <p className="step-body">{step.body}</p>
                          {step.action && (
                            <Button
                              variant="primary"
                              icon={<IconPlay size={14} />}
                              loading={step.action.busyKey ? app.busy[step.action.busyKey] : false}
                              disabled={!!step.action.disabledReason}
                              title={step.action.disabledReason}
                              onClick={step.action.run}
                            >
                              {step.action.label}
                            </Button>
                          )}
                          {step.action?.disabledReason && <p className="step-hint">{step.action.disabledReason}.</p>}
                        {step.pointer && <p className="step-pointer">{step.pointer}</p>}
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            {currentIndex === -1 && (
              <p className="walkthrough-done">
                <IconShield size={16} /> Every step is done. Open <button className="link" onClick={() => go("disputes")}>Disputes</button> to send
                evidence for a real PayPal dispute.
              </p>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Recent activity"
              actions={
                <Button size="sm" variant="ghost" icon={<IconArrowRight size={14} />} onClick={() => go("ledger")}>
                  Full ledger
                </Button>
              }
            />
            {activity.length === 0 ? (
              <EmptyState icon={<IconList size={20} />} title="No activity yet">
                Every proposal, approval, payment and dispute decision is recorded here.
              </EmptyState>
            ) : (
              <ul className="activity">
                {activity.map((entry: AnyRecord) => (
                  <li key={entry.id}>
                    <ActorMark actor={entry.actor} />
                    <div className="activity-text">
                      <span>{eventLabel(entry.eventType)}</span>
                      <small>
                        {ACTOR_LABEL[entry.actor] || entry.actor}
                        {entry.amount ? ` · ${money(entry.amount)}` : ""} · {timeAgo(entry.createdAt)}
                      </small>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  tone = "neutral",
  meter,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "ok" | "warn" | "bad" | "neutral";
  meter?: number;
}) {
  return (
    <div className={`stat stat-${tone}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {typeof meter === "number" && (
        <span className="meter" aria-hidden="true">
          <span style={{ width: `${Math.min(100, Math.max(0, meter * 100))}%` }} />
        </span>
      )}
      <span className="stat-detail">{detail}</span>
    </div>
  );
}
