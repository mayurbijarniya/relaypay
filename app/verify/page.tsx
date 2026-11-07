import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PublicShell } from "@/components/PublicShell";
import { Checks, Lit } from "@/components/kit";

export const metadata: Metadata = {
  title: "Verify a receipt · RelayPay",
  description: "Paste a RelayPay receipt hash or a PayPal custom_id to check the café's approval receipt.",
};

export const dynamic = "force-dynamic";

export default async function VerifyLookupPage({ searchParams }: { searchParams: Promise<{ hash?: string }> }) {
  const { hash: raw } = await searchParams;
  const hash = String(raw || "").trim().toLowerCase();
  const valid = /^[a-f0-9]{64}$/.test(hash);
  if (valid) redirect(`/r/${hash}`);

  return (
    <PublicShell current="verify">
      <div className="pub-wrap verify">
        <div className="verify-copy">
          <p className="docs-kicker">Verify a receipt</p>
          <h1>Check a café&apos;s approval receipt</h1>
          <p className="docs-lead">
            Paste the 64-character SHA-256 receipt hash, or the <code>custom_id</code> from the PayPal order. RelayPay recomputes the receipt&apos;s fingerprint and shows
            whether it still matches the PayPal payment.
          </p>
          <form className="verify-form" action="/verify" method="get">
            <label className="sr-only" htmlFor="hash">
              Receipt hash or PayPal custom_id
            </label>
            <input
              id="hash"
              name="hash"
              className="input input-lg mono-input"
              placeholder="e.g. 36f51e1c3a613e31a7f16d47fc4ed497…"
              defaultValue={raw || ""}
              autoComplete="off"
              spellCheck={false}
              required
            />
            <button type="submit" className="btn btn-primary btn-md">
              Verify
            </button>
          </form>
          {raw && !valid && <p className="verify-error">That isn&apos;t a receipt hash. It should be 64 characters of 0–9 and a–f.</p>}
          <p className="muted small">
            Want to check it without RelayPay? <a href="/docs#verify-yourself">Hash it yourself</a>.
          </p>
        </div>
        <Lit tone="sky" className="verify-lit">
          <Checks
            title="What gets checked"
            right={<span className="k-meta">5 checks</span>}
            items={[
              { ok: null, label: "The receipt is unchanged since approval", detail: "SHA-256 recomputed from the stored receipt" },
              { ok: null, label: "PayPal's custom_id equals the receipt hash" },
              { ok: null, label: "PayPal's amount equals the approved amount" },
              { ok: null, label: "PayPal captured the payment" },
              { ok: null, label: "Re-checked against PayPal's live record", detail: "When the merchant last ran Verify with PayPal" },
            ]}
          />
        </Lit>
      </div>
    </PublicShell>
  );
}
