"use client";

import { useMemo, useState } from "react";
import { AgentTrace, Button, Callout, Card, Disclosure, Dot, EmptyState, Pill, RawJson } from "@/components/ui";
import { AgentMark, BrandIcon, BrandTile, Chat, ChatHead, Checks, Lit, MsgBot, MsgMe, Source } from "@/components/kit";
import { IconArrowRight, IconCheck, IconPlay, IconReceipt, IconRefresh, IconScale, IconX } from "@/components/icons";
import {
  HASH_SOURCE_TEXT,
  dateTime,
  disputeStage,
  isPayPalVerified,
  isSample,
  money,
  reasonLabel,
  shortId,
  timeAgo,
  type AnyRecord,
} from "@/lib/format";
import type { RelayPay } from "@/components/useRelayPay";

const SAMPLE_REASONS = [
  { value: "UNAUTHORISED", label: "“I didn't authorize this”" },
  { value: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", label: "“It never arrived”" },
  { value: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", label: "“Not as described”" },
];

export function DisputesView({ app }: { app: RelayPay }) {
  const data = app.data!;
  const [disputeId, setDisputeId] = useState("");
  const [reason, setReason] = useState(SAMPLE_REASONS[0].value);
  const disputes = useMemo(() => [...data.disputes].reverse(), [data.disputes]);
  const real = disputes.filter((d) => !isSample(d));
  const samples = disputes.filter((d) => isSample(d));

  return (
    <div className="stack-lg">
      <div className="dispute-intake">
        <Card>
          <div className="intake-head">
            <div>
              <h2 className="card-title">
                <BrandTile name="paypal" size="sm" />
                PayPal disputes
              </h2>
              <p className="card-subtitle">
                {app.data!.config.webhookConfigured
                  ? "New disputes arrive automatically through the signed PayPal webhook."
                  : "Webhooks aren't set up, so check PayPal for new disputes, or paste an ID."}
              </p>
            </div>
            <Button size="sm" icon={<IconRefresh size={14} />} loading={app.busy.sync} onClick={() => void app.actions.syncDisputes()}>
              Check PayPal for new disputes
            </Button>
          </div>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void app.actions.draftReal(disputeId).then((d) => d && setDisputeId(""));
            }}
          >
            <label className="sr-only" htmlFor="dispute-id">
              PayPal dispute ID
            </label>
            <input
              id="dispute-id"
              className="input mono-input"
              placeholder="PP-D-12345"
              value={disputeId}
              onChange={(e) => setDisputeId(e.target.value)}
            />
            <Button type="submit" variant="primary" loading={app.busy["draft-real"]} disabled={!disputeId.trim()}>
              Import and draft
            </Button>
          </form>
        </Card>
        <Card>
          <h2 className="card-title">
            <AgentMark size={22} />
            Try a sample dispute
          </h2>
          <p className="card-subtitle">
            {app.latestCapture
              ? `Runs the dispute agent against your latest real capture (${money(app.latestCapture.amount)}). Never sent to PayPal.`
              : "Charge an order first. The sample links to a real PayPal capture."}
          </p>
          <div className="inline-form">
            <label className="sr-only" htmlFor="sample-reason">
              Buyer's claim
            </label>
            <select id="sample-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
              {SAMPLE_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <Button
              icon={<IconPlay size={14} />}
              loading={app.busy["draft-sample"]}
              disabled={!app.latestCapture}
              onClick={() => void app.actions.draftSample(reason)}
            >
              Run sample
            </Button>
          </div>
        </Card>
      </div>

      {disputes.length === 0 ? (
        <Card>
          <EmptyState icon={<IconScale size={22} />} title="No disputes">
            If a café payment is disputed, the agent reads the case, checks the approval receipt against PayPal&apos;s copy
            of its fingerprint, and drafts your response. You approve it before anything is sent.
          </EmptyState>
        </Card>
      ) : (
        <>
          {real.length > 0 && (
            <section className="stack">
              <h2 className="section-title">PayPal disputes</h2>
              {real.map((d) => (
                <DisputeCase key={d.id} app={app} dispute={d} />
              ))}
            </section>
          )}
          {samples.length > 0 && (
            <section className="stack">
              <h2 className="section-title">Samples</h2>
              {samples.map((d) => (
                <DisputeCase key={d.id} app={app} dispute={d} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function merchantResponse(draft?: string) {
  if (!draft) return "";
  const marker = draft.indexOf("Merchant response:");
  if (marker < 0) return draft.split(/\n\s*\n/).pop()!.trim();
  const rest = draft.slice(marker + "Merchant response:".length);
  // Newer drafts put the response first, followed by "Evidence:".
  const end = rest.indexOf("\n\nEvidence:");
  return (end >= 0 ? rest.slice(0, end) : rest).trim();
}

const PAYPAL_STATUS: Record<string, string> = {
  OPEN: "Open with the buyer",
  WAITING_FOR_BUYER_RESPONSE: "Waiting for the buyer",
  WAITING_FOR_SELLER_RESPONSE: "PayPal is waiting for your evidence",
  UNDER_REVIEW: "Under review by PayPal",
  RESOLVED: "Resolved",
  OTHER: "Other",
};

function DisputeCase({ app, dispute }: { app: RelayPay; dispute: AnyRecord }) {
  const sample = isSample(dispute);
  const order = dispute.orderId ? app.data!.orders.find((o) => o.id === dispute.orderId) : undefined;
  const intent = order ? app.intentsById[order.intentId] : undefined;
  const contest = dispute.agentRecommendation === "CONTEST";
  const verifiedAtPayPal = !!dispute.hashVerified && isPayPalVerified(dispute.hashSource);
  const stage = disputeStage(dispute);
  const closed = !!dispute.submitted || !!dispute.resolution;
  const canSend = !sample && contest && verifiedAtPayPal && dispute.merchantApproved && !closed;
  const response = merchantResponse(dispute.agentDraft);
  const links: string[] = Array.isArray(dispute.paypalLinks) ? dispute.paypalLinks : [];
  const readyForEvidence = dispute.status === "WAITING_FOR_SELLER_RESPONSE" || links.includes("provide-evidence");
  const advance =
    !sample && !closed && app.data!.config.sandbox && !readyForEvidence ? (
      <Button
        variant="ghost"
        icon={<IconArrowRight size={15} />}
        loading={app.busy[`advance:${dispute.id}`]}
        onClick={() => void app.actions.advanceDispute(dispute)}
        title="Sandbox only: escalate and request seller evidence so PayPal accepts your evidence"
      >
        Advance in sandbox
      </Button>
    ) : null;

  return (
    <article className={`case ${contest ? "case-contest" : "case-refund"}`}>
      <header className="case-head">
        <div>
          <div className="case-kicker">
            {sample ? <Pill tone="neutral">Sample · never sent to PayPal</Pill> : <code>{dispute.paypalDisputeId}</code>}
            <span>opened {timeAgo(dispute.createdAt)}</span>
          </div>
          <h3 className="case-title">{reasonLabel(dispute.reason)}</h3>
          <p className="case-sub">
            {intent ? `${intent.quantity} × ${intent.product} · ${money(intent.amount)}` : "No RelayPay purchase is linked to this payment"}
            {dispute.captureId ? ` · capture ${shortId(dispute.captureId, 6, 4)}` : ""}
          </p>
          {!sample && !closed && (
            <p className="case-paypal">
              <Dot tone={dispute.status === "WAITING_FOR_SELLER_RESPONSE" ? "warn" : "neutral"} />
              PayPal: {PAYPAL_STATUS[dispute.status] || dispute.status}
              {dispute.sellerResponseDueDate ? ` · respond by ${dateTime(dispute.sellerResponseDueDate)}` : ""}
            </p>
          )}
        </div>
        <Pill tone={stage.tone}>{stage.label}</Pill>
      </header>

      <div className="case-grid">
        <div className="k-panel case-chat">
          <ChatHead title="Dispute agent" status={sample ? "Sample" : "PayPal case"} />
          <Chat>
            <MsgMe>{reasonLabel(dispute.reason)}.</MsgMe>
            <MsgBot
              note={`${dispute.toolCalls?.length || 0} tool calls`}
              sources={
                <>
                  <Source icon={<IconReceipt size={13} />}>Approval receipt</Source>
                  <Source icon={<BrandIcon name="paypal" size={13} />}>PayPal capture</Source>
                </>
              }
            >
              <b>{contest ? "I recommend contesting: the receipt matches PayPal's copy." : "I recommend refunding the café."}</b>
              {dispute.agentDecisionReason ? <> {dispute.agentDecisionReason}</> : null}
            </MsgBot>
          </Chat>
        </div>
        <Lit tone="sky" className="case-lit">
          <Checks
            title="Evidence checks"
            items={[
              {
                ok: !!intent?.approvedBy,
                label: intent?.approvedBy ? `Café approval on record (${intent.approvedBy})` : "No café approval on record",
                detail: intent?.approvedAt ? `before payment, ${dateTime(intent.approvedAt)}` : undefined,
              },
              {
                ok: verifiedAtPayPal ? true : dispute.hashSource === "MISMATCH" ? false : dispute.hashSource === "STORED_RECEIPT" ? null : false,
                label: verifiedAtPayPal
                  ? `Fingerprint matches the ${HASH_SOURCE_TEXT[dispute.hashSource]}`
                  : `Fingerprint: ${HASH_SOURCE_TEXT[dispute.hashSource] || "not checked"}`,
                detail: dispute.paypalDisputeCustomId ? `custom_id ${shortId(dispute.paypalDisputeCustomId, 10, 6)}` : undefined,
              },
              {
                ok: intent ? Number(intent.amount) === Number(order?.amount) : null,
                label: intent ? `Amount is ${money(intent.amount)}` : "No approved amount on record",
              },
              {
                ok: !!order?.captureId,
                label: order?.captureId ? "Linked to the PayPal capture" : "No matching PayPal capture",
                detail: order?.captureId,
              },
            ]}
          />
        </Lit>
      </div>

      <div className="case-response">
        <h4 className="case-h4">Your response to PayPal</h4>
        {response ? <blockquote className="response">{response}</blockquote> : <p className="muted">No response drafted.</p>}
        {contest && intent?.receiptHash && order ? (
          <div className="k-evidence">
            <a className="k-file k-file--link" href={`/api/disputes/${dispute.id}/evidence`} target="_blank" rel="noreferrer" title="Open the evidence PDF">
              <BrandTile name="pdf" size="lg" />
              <span className="k-file__name">Evidence packet.pdf</span>
              <span className="k-file__kind">{closed && dispute.submitted ? "Sent to PayPal" : "Open preview"}</span>
            </a>
            <div className="k-evidence__parts">
              <span className="k-evidence__title">{dispute.submitted ? "Sent with your response" : "Sent with your response when you choose Send evidence"}</span>
              <ul>
                <li>
                  <BrandIcon name="json" size={16} />
                  Approval receipt · <code>{shortId(intent.receiptHash, 8, 6)}</code>
                </li>
                <li>
                  <BrandIcon name="paypal" size={16} />
                  PayPal capture · <code>{order.captureId || order.paypalOrderId}</code>
                </li>
                <li>
                  <BrandIcon name="log" size={16} />
                  Timeline · proposal, approval, charge and dispute
                </li>
              </ul>
            </div>
          </div>
        ) : (
          <p className="muted small">{contest ? "No linked receipt, so there is no evidence packet." : "No evidence is sent when you refund."}</p>
        )}
      </div>

      <div className="case-disclosures">
        <Disclosure summary={<>How the agent decided<span className="disclosure-meta">{dispute.toolCalls?.length || 0} tool calls</span></>}>
          <AgentTrace calls={dispute.toolCalls} />
        </Disclosure>
        <Disclosure summary="Exact payload for PayPal provide-evidence">
          <RawJson value={dispute.agentPayload} />
        </Disclosure>
      </div>

      {sample && dispute.merchantApproved && (
        <Callout tone="info" title="This is a sample">
          The response above is exactly what RelayPay would send. Samples have no PayPal dispute, so nothing can be submitted.
        </Callout>
      )}
      {!sample && dispute.merchantApproved && !closed && contest && !verifiedAtPayPal && (
        <Callout tone="warn" title="RelayPay won't contest this">
          The receipt fingerprint couldn&apos;t be matched in PayPal&apos;s records, so contesting would likely fail.
        </Callout>
      )}

      <footer className="case-actions">
        {closed ? (
          <span className="action-hint">
            {dispute.submitted ? (
              <>
                <IconCheck size={14} /> Evidence and PDF were sent to PayPal.
              </>
            ) : dispute.resolution === "ACCEPTED" ? (
              "You accepted the claim. PayPal refunds the café."
            ) : (
              `Resolved: ${dispute.resolution}`
            )}
          </span>
        ) : !dispute.merchantApproved ? (
          <>
            {advance}
            <Button
              variant="primary"
              icon={<IconCheck size={15} />}
              loading={app.busy[`dapprove:${dispute.id}`]}
              onClick={() => void app.actions.approveDispute(dispute)}
            >
              Approve this response
            </Button>
          </>
        ) : sample ? (
          <span className="action-hint">Approved. Nothing was sent.</span>
        ) : (
          <>
            {advance}
            <Button
              variant={canSend ? "ghost" : "danger"}
              icon={<IconX size={15} />}
              loading={app.busy[`daccept:${dispute.id}`]}
              onClick={() => app.actions.acceptDispute(dispute)}
            >
              {canSend ? "Refund instead" : "Accept claim and refund"}
            </Button>
            {canSend && (
              <Button
                variant="success"
                icon={<IconArrowRight size={15} />}
                loading={app.busy[`dsubmit:${dispute.id}`]}
                onClick={() => app.actions.submitDispute(dispute)}
              >
                Send evidence to PayPal
              </Button>
            )}
          </>
        )}
      </footer>
    </article>
  );
}
