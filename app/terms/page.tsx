import type { Metadata } from "next";
import { PublicShell } from "@/components/PublicShell";

export const metadata: Metadata = {
  title: "Terms · RelayPay",
  description: "The terms for using the RelayPay prototype in the PayPal sandbox.",
};

export default function TermsPage() {
  return (
    <PublicShell current="terms">
      <article className="pub-wrap legal">
        <p className="docs-kicker">Terms</p>
        <h1>Terms of use</h1>
        <p className="docs-lead">RelayPay is an open-source prototype built for the PayPal AI Hackathon. By using it you agree to the points below.</p>

        <h2>Sandbox only</h2>
        <p>
          The hosted demo uses the PayPal sandbox. Payments, captures, refunds and disputes are test transactions and move no real money. Don&apos;t enter real card
          details or real customer data.
        </p>

        <h2>What a receipt is, and isn&apos;t</h2>
        <p>
          A receipt that matches PayPal&apos;s copy shows it existed at payment time and has not changed since. It records who RelayPay says approved the order. It is not
          a legal guarantee and does not decide a dispute; PayPal decides disputes.
        </p>

        <h2>The AI agents</h2>
        <p>
          The agents propose orders and draft dispute responses. They can be wrong. Nothing is charged until the café approves, and nothing is sent to PayPal until
          the merchant chooses to send it.
        </p>

        <h2>No warranty</h2>
        <p>
          The software is provided &ldquo;as is&rdquo;, without warranty of any kind, under the MIT License in the repository. The demo may be reset or taken down at any
          time.
        </p>

        <h2>Trademarks</h2>
        <p>PayPal, Zapier, Channel3, Neon, Render and AG Grid are trademarks of their owners. RelayPay is not affiliated with or endorsed by them.</p>

        <h2>Contact</h2>
        <p>
          Email <a href="mailto:hello@relaypay.example">hello@relaypay.example</a>.
        </p>
        <p className="muted small">Last updated November 2026.</p>
      </article>
    </PublicShell>
  );
}
