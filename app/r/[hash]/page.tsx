import type { Metadata } from "next";
import { loadDB } from "@/lib/store";
import { canonicalReceipt, hashReceipt, verifyReceipt } from "@/lib/receipts";
import { IconX, IconShield, IconLock } from "@/components/icons";
import { PublicShell } from "@/components/PublicShell";
import { BrandIcon, Checks, DocMark, Lit, ReceiptDoc } from "@/components/kit";
import { dateTime, money, policyLabel, shortId } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Receipt check · RelayPay",
  description: "Check that a café's approval receipt is unchanged and matches the fingerprint PayPal holds as custom_id.",
};

export default async function VerifyPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash: raw } = await params;
  const hash = decodeURIComponent(raw || "").trim().toLowerCase();
  const db = await loadDB();
  const intent = /^[a-f0-9]{64}$/.test(hash) ? db.intents.find((i) => i.receiptHash === hash) : undefined;
  const order = intent ? db.orders.find((o) => o.intentId === intent.id && o.status === "COMPLETED") || db.orders.find((o) => o.intentId === intent.id) : undefined;


  if (!intent?.receiptPayload) {
    return (
      <PublicShell>
        <main className="public-main">
          <section className="card card-padded public-card">
            <h1 className="public-title">Receipt not found</h1>
            <p className="muted">
              No sealed receipt matches <code className="break">{hash || "(empty)"}</code>.
            </p>
            <p className="muted small">Paste the full 64-character SHA-256 hash from a RelayPay receipt or PayPal custom_id on <a href="/verify">Verify a receipt</a>.</p>
          </section>
        </main>
      </PublicShell>
    );
  }

  const payload = intent.receiptPayload;
  const unchanged = verifyReceipt(payload, hash);
  const recomputed = hashReceipt(payload);
  const customIdMatches = !!order && order.customId === hash;
  const amountMatches = !!order && Number(order.amount) === Number(payload.amount);
  const captured = order?.status === "COMPLETED";
  const paypalVerified = order?.verificationSource === "PAYPAL_CUSTOM_ID";
  const all = unchanged && customIdMatches && amountMatches && captured && paypalVerified;

  return (
    <PublicShell>
      <main className="public-main">
        <div className={`public-verdict ${unchanged ? (all ? "ok" : "partial") : "bad"}`}>
          <span className="public-verdict-icon">{unchanged ? <IconShield size={22} /> : <IconX size={22} />}</span>
          <div>
            <h1 className="public-title">
              {!unchanged ? "This receipt has been altered" : all ? "Receipt verified with PayPal" : "Receipt is unchanged"}
            </h1>
            <p>
              {!unchanged
                ? "The stored receipt no longer hashes to this value."
                : all
                  ? "The receipt is unchanged since the café approved it, PayPal holds the same fingerprint as custom_id, and PayPal captured the approved amount."
                  : order
                    ? "The receipt is unchanged and matches the PayPal order. It has not been re-checked against PayPal from this page."
                    : "The receipt is unchanged. No PayPal payment is linked to it yet."}
            </p>
          </div>
        </div>

        <div className="public-grid">
          <Lit tone="sage" className="public-lit">
            <ReceiptDoc
              label={`Approval receipt · sealed ${dateTime(payload.approvedAt)}`}
              seal={
                <span className={`pill ${!unchanged ? "pill-bad" : all ? "pill-ok" : "pill-neutral"}`}>
                  {!unchanged ? <IconX size={12} /> : all ? <IconShield size={12} /> : <IconLock size={12} />}
                  {!unchanged ? "Altered" : all ? "Verified with PayPal" : "Sealed"}
                </span>
              }
              title={
                <>
                  {payload.product} · {payload.quantity} × {money(payload.policyChecks?.catalogPrice || Number(payload.amount) / Number(payload.quantity || 1))}
                </>
              }
              total={{ label: `Total (${payload.currency})`, value: money(payload.amount) }}
              fingerprint={{ label: "SHA-256 receipt hash", value: <code className="break">{hash}</code> }}
              note={
                !unchanged
                  ? { kind: "Altered", msg: "The stored receipt no longer hashes to this value.", tone: "bad" }
                  : order && customIdMatches
                    ? { kind: "Match", msg: "PayPal's custom_id equals this receipt's fingerprint.", where: paypalVerified ? `PayPal order record, checked ${dateTime(order.verifiedAt)}` : "RelayPay's copy of the PayPal order" }
                    : { kind: "No PayPal copy yet", msg: "No PayPal payment is linked to this receipt.", tone: "neutral" }
              }
            >
              <p>
                Approved by <DocMark plain>{payload.approvedBy}</DocMark> before payment. Agent {payload.agentId}, policy {policyLabel(payload.policyVersion)}.
              </p>
              <p>
                Fingerprint <DocMark mono>{shortId(hash, 10, 7)}</DocMark> {order ? "sent to PayPal as the order's custom_id." : "goes to PayPal as custom_id when the order is charged."}
              </p>
              <p>Any edit to this receipt changes its fingerprint, so it no longer matches PayPal&apos;s copy.</p>
            </ReceiptDoc>
          </Lit>

          <section className="public-side">
            <Checks
              title="Verify with PayPal"
              items={[
                { ok: unchanged, label: "Receipt is unchanged since approval", detail: `Recomputed ${shortId(recomputed, 12, 8)}` },
                { ok: order ? customIdMatches : null, label: "PayPal custom_id equals the receipt hash", detail: order ? shortId(order.customId, 12, 8) : "No PayPal order yet" },
                { ok: order ? amountMatches : null, label: "PayPal amount equals the approved amount", detail: order ? money(order.amount) : undefined },
                { ok: order ? captured : null, label: "PayPal captured the payment", detail: order?.captureId },
                {
                  ok: order ? (paypalVerified ? true : null) : null,
                  label: "Re-checked against PayPal's live record",
                  detail: paypalVerified ? `Last checked ${dateTime(order?.verifiedAt)}` : "Run “Verify with PayPal” in RelayPay",
                },
              ]}
            />
            {order && (
              <div className="k-panel public-ids">
                <dl className="kv">
                  <div className="kv-row">
                    <dt>
                      <BrandIcon name="paypal" size={13} /> PayPal order
                    </dt>
                    <dd>
                      <code>{order.paypalOrderId}</code>
                    </dd>
                  </div>
                  <div className="kv-row">
                    <dt>
                      <BrandIcon name="paypal" size={13} /> Capture
                    </dt>
                    <dd>
                      <code>{order.captureId || "—"}</code>
                    </dd>
                  </div>
                </dl>
              </div>
            )}
            <details className="disclosure">
              <summary>Canonical receipt (exactly what was hashed)</summary>
              <div className="disclosure-body">
                <pre className="raw-json">{canonicalReceipt(payload)}</pre>
                <p className="muted small">SHA-256 of exactly this text, byte for byte, is the receipt hash. <a href="/docs#verify-yourself">Check it yourself</a>.</p>
              </div>
            </details>
          </section>
        </div>
        <p className="public-foot muted small">
          RelayPay seals the café&apos;s approval into a receipt and sends its SHA-256 fingerprint to PayPal as the order&apos;s custom_id.
          That makes the record tamper-evident: anyone holding the receipt can recompute the fingerprint and compare it with PayPal&apos;s copy.
        </p>
      </main>
    </PublicShell>
  );
}
