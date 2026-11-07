"use client";

import { useState } from "react";
import { Button, CopyValue, Disclosure, Drawer, Pill, RawJson, AgentTrace } from "@/components/ui";
import { Checks, Code, DocMark, Lit, ReceiptDoc } from "@/components/kit";
import { IconExternal, IconLock, IconShield } from "@/components/icons";
import { agentModeLabel, dateTime, money, shortId, type AnyRecord } from "@/lib/format";
import type { RelayPay } from "@/components/useRelayPay";

const DISPUTE_REASONS = [
  { value: "UNAUTHORISED", label: "“I didn't authorize this”" },
  { value: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", label: "“It never arrived”" },
  { value: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", label: "“Not as described”" },
];

/** Sandbox testing aid: open a real sandbox dispute against this payment. */
function OpenSandboxDispute({ app, order }: { app: RelayPay; order: AnyRecord }) {
  const [txn, setTxn] = useState("");
  const [reason, setReason] = useState(DISPUTE_REASONS[0].value);
  const configured = app.data!.config.sandboxBuyerConfigured;
  return (
    <section className="drawer-section">
      <h3>Test a dispute (sandbox)</h3>
      <Disclosure summary="Open a real sandbox dispute against this payment">
        <ol className="steps-list">
          <li>
            Log in to{" "}
            <a href="https://www.sandbox.paypal.com/myaccount/activities/" target="_blank" rel="noreferrer">
              sandbox.paypal.com
            </a>{" "}
            as the sandbox buyer and open this {money(order.amount)} payment.
          </li>
          <li>Either choose “Report a problem” there, then press “Check PayPal for new disputes” on the Disputes page,</li>
          <li>or copy the buyer&apos;s transaction ID from that page and open the dispute from here.</li>
        </ol>
        {configured ? (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void app.actions.openSandboxDispute(order, txn, reason);
            }}
          >
            <input
              className="input mono-input"
              aria-label="Buyer transaction ID"
              placeholder="Buyer transaction ID"
              value={txn}
              onChange={(e) => setTxn(e.target.value.trim())}
            />
            <select className="input" aria-label="Buyer's claim" value={reason} onChange={(e) => setReason(e.target.value)}>
              {DISPUTE_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <Button type="submit" variant="secondary" loading={app.busy[`open-dispute:${order.id}`]} disabled={txn.length < 8}>
              Open dispute
            </Button>
          </form>
        ) : (
          <p className="muted small">Set SANDBOX_BUYER_EMAIL on the server to open disputes from RelayPay. The buyer-account route above always works.</p>
        )}
        <p className="muted small">
          PayPal only allows in-app creation if your REST app has the dispute-create permission; otherwise RelayPay tells you and the buyer-account route
          is the way.
        </p>
      </Disclosure>
    </section>
  );
}

export function ReceiptDrawer({
  app,
  intent,
  onClose,
}: {
  app: RelayPay;
  intent: AnyRecord | null;
  onClose: () => void;
}) {
  if (!intent) return null;
  const receipt = intent.receiptPayload as AnyRecord | undefined;
  const order = app.ordersByIntent[intent.id];
  const check = order ? app.verifications[order.id] : undefined;
  const verified = app.isVerified(order);
  const checks = receipt?.policyChecks || intent.policyChecks || {};
  const unitPrice = checks.catalogPrice || (Number(intent.amount) / Number(intent.quantity || 1)).toFixed(2);
  const paid = order?.status === "COMPLETED";

  return (
    <Drawer
      open
      onClose={onClose}
      title={receipt ? "Approval receipt" : "Order proposal"}
      subtitle={receipt ? "Sealed when the café approved it. PayPal keeps a copy of its fingerprint as custom_id." : "Not sealed yet. The café's approval creates the receipt."}
      footer={
        <>
          {receipt && (
            <Button href={`/r/${intent.receiptHash}`} external icon={<IconExternal size={15} />} variant="ghost">
              Public verification page
            </Button>
          )}
          {order && paid && (
            <Button
              variant="primary"
              icon={<IconShield size={16} />}
              loading={app.busy[`verify:${order.id}`]}
              onClick={() => app.actions.verify(order)}
            >
              {verified ? "Verify again" : "Verify with PayPal"}
            </Button>
          )}
        </>
      }
    >
      <Lit tone="sage" className="drawer-lit">
        <ReceiptDoc
          draft={!receipt}
          label={receipt ? `Approval receipt · sealed ${dateTime(receipt.approvedAt)}` : "Order proposal · not sealed yet"}
          seal={
            receipt ? (
              <Pill tone={verified ? "ok" : "neutral"} icon={verified ? <IconShield size={12} /> : <IconLock size={12} />}>
                {verified ? "Verified with PayPal" : "Sealed"}
              </Pill>
            ) : (
              <Pill tone="warn">Draft</Pill>
            )
          }
          title={
            <>
              {intent.product} · {intent.quantity} × {money(unitPrice)}
            </>
          }
          total={{ label: `Total (${intent.currency || "USD"})`, value: money(intent.amount) }}
          fingerprint={receipt ? { label: "SHA-256 fingerprint (PayPal custom_id)", value: <CopyValue value={intent.receiptHash} /> } : undefined}
          note={
            !receipt
              ? undefined
              : verified
                ? { kind: "Match", msg: "PayPal's custom_id equals this receipt's fingerprint.", where: `PayPal order record${order?.verifiedAt ? `, checked ${dateTime(order.verifiedAt)}` : ""}` }
                : check && !check.customIdMatches
                  ? { kind: "No match", msg: "PayPal's custom_id differs from this receipt's fingerprint.", where: "PayPal order record", tone: "bad" }
                  : { kind: "Not checked yet", msg: paid ? "Run “Verify with PayPal” to compare it with PayPal's copy." : "Charge the order to give PayPal a copy.", tone: "neutral" }
          }
        >
          {receipt ? (
            <>
              <p>
                Approved by <DocMark plain>{receipt.approvedBy}</DocMark> before payment, after the agent&apos;s proposal and {intent.toolCalls?.length || 0} tool calls.
                Policy {checks.policyVersion || "—"} checks passed{receipt.highValueConfirmed ? ", high value confirmed by the café" : ""}.
              </p>
              <p>
                Fingerprint <DocMark mono>{shortId(intent.receiptHash, 10, 7)}</DocMark> {order ? "sent to PayPal as the order's custom_id." : "goes to PayPal as custom_id when the order is charged."}
              </p>
              {order && paid && (
                <p>
                  PayPal captured <DocMark plain>{money(order.amount)}</DocMark> with the café&apos;s saved Vault payment method, no redirect.
                </p>
              )}
              <p>Any edit to this receipt changes its fingerprint, so it no longer matches PayPal&apos;s copy.</p>
            </>
          ) : (
            <p>Proposed by {intent.agentId || "the agent"}. The café&apos;s approval seals it into a receipt and fingerprints it with SHA-256.</p>
          )}
        </ReceiptDoc>
      </Lit>

      {order ? (
        <section className="drawer-section">
          <h3>PayPal payment</h3>
          <Code
            file="orders/create.ts"
            chip={paid ? <Pill tone="ok">Captured</Pill> : <Pill tone="warn">{order.status}</Pill>}
            lines={[
              { code: <><span className="k">const</span> order = <span className="k">await</span> <span className="f">createOrder</span>({"{"}</> },
              { code: <>  amount: <span className="s">&quot;{order.amount}&quot;</span>,</> },
              { code: <>  custom_id: <span className="s">&quot;{shortId(order.customId, 10, 6)}&quot;</span>,</>, mark: true },
              { code: <>  vault_id: <span className="s">&quot;{app.data!.vault.vaultIdPreview || "vault"}&quot;</span>,</> },
              { code: <>{"});"}</> },
              { code: <><span className="c">{`// ${order.paypalOrderId}`}</span></> },
            ]}
            hint="The receipt's fingerprint, stored by PayPal."
          />
          <dl className="kv drawer-kv">
            <div className="kv-row">
              <dt>Order</dt>
              <dd>
                <CopyValue value={order.paypalOrderId} />
              </dd>
            </div>
            <div className="kv-row">
              <dt>Capture</dt>
              <dd>
                <CopyValue value={order.captureId} />
              </dd>
            </div>
            <div className="kv-row">
              <dt>Captured</dt>
              <dd>{dateTime(order.capturedAt || order.createdAt)}</dd>
            </div>
          </dl>
        </section>
      ) : receipt ? (
        <section className="drawer-section">
          <h3>PayPal payment</h3>
          <p className="muted">Not charged yet. Use “Charge with PayPal” on the order to capture it with the café&apos;s Vault.</p>
        </section>
      ) : null}

      {order && paid && (
        <section className="drawer-section">
          <h3>Verification against PayPal</h3>
          {check ? (
            <Checks
              title="Verify with PayPal"
              items={[
                { ok: check.receiptMatches, label: "Receipt is unchanged since the café approved it", detail: "Recomputed SHA-256 equals the sealed fingerprint." },
                { ok: check.customIdMatches, label: "PayPal holds the same fingerprint", detail: `PayPal custom_id ${shortId(check.paypalCustomId, 10, 6)}` },
                { ok: check.amountMatches, label: "PayPal charged the amount the café approved", detail: money(intent.amount) },
                { ok: check.paypalCaptured && check.captureMatches, label: "Capture is complete and matches", detail: shortId(check.captureId, 8, 6) },
              ]}
            />
          ) : verified ? (
            <p className="verify-note ok">
              <IconShield size={16} /> Verified with PayPal {order.verifiedAt ? dateTime(order.verifiedAt) : ""}. Run it again to see each check.
            </p>
          ) : (
            <p className="muted">
              RelayPay re-reads the order from PayPal, recomputes the receipt hash and compares it with PayPal&apos;s{" "}
              <code>custom_id</code>, the amount and the capture.
            </p>
          )}
        </section>
      )}

      {intent.marketCheck && (
        <section className="drawer-section">
          <h3>Market price check (Channel3)</h3>
          <dl className="kv">
            <div className="kv-row">
              <dt>Verdict</dt>
              <dd>
                <Pill tone={intent.marketCheck.verdict === "ABOVE_MARKET" ? "warn" : intent.marketCheck.verdict === "NO_DATA" ? "neutral" : "ok"}>
                  {String(intent.marketCheck.verdict).replace(/_/g, " ").toLowerCase()}
                </Pill>
              </dd>
            </div>
            <div className="kv-row">
              <dt>Supplier price</dt>
              <dd>{money(intent.marketCheck.catalogPrice)}</dd>
            </div>
            <div className="kv-row">
              <dt>Market median</dt>
              <dd>
                {intent.marketCheck.medianPrice ? money(intent.marketCheck.medianPrice) : "—"} across {intent.marketCheck.offerCount} live offers
              </dd>
            </div>
          </dl>
          <p className="muted small">Sealed into the receipt, so it shows the agent checked the market before the café approved.</p>
        </section>
      )}

      {order && paid && app.data!.config.sandbox && <OpenSandboxDispute app={app} order={order} />}

      <section className="drawer-section">
        <h3>How the agent decided</h3>
        <p className="muted small">
          {agentModeLabel(intent.agentMode)} · {intent.model || "—"} · prompt {intent.promptHash || "—"}
        </p>
        <AgentTrace calls={intent.toolCalls} />
      </section>

      {receipt && (
        <Disclosure summary="Canonical receipt (exactly what was hashed)">
          {intent.receiptCanonical ? (
            <>
              <pre className="raw-json">{intent.receiptCanonical}</pre>
              <p className="muted small">SHA-256 of exactly this text, byte for byte, is the fingerprint PayPal holds as custom_id.</p>
            </>
          ) : (
            <RawJson value={receipt} />
          )}
        </Disclosure>
      )}
    </Drawer>
  );
}
