import type { Metadata } from "next";
import { PublicShell } from "@/components/PublicShell";

export const metadata: Metadata = {
  title: "Privacy · RelayPay",
  description: "What RelayPay stores, what it shares with PayPal and its other services, and what it never collects.",
};

export default function PrivacyPage() {
  return (
    <PublicShell current="privacy">
      <article className="pub-wrap legal">
        <p className="docs-kicker">Privacy</p>
        <h1>Privacy</h1>
        <p className="docs-lead">
          RelayPay is a hackathon prototype that runs against the PayPal sandbox. No real money moves and no real customer should use it. This page says plainly
          what it stores and where data goes.
        </p>

        <h2>What RelayPay stores</h2>
        <ul className="docs-list">
          <li>The agent&apos;s proposals: product, quantity, amount, its reasoning and the tool calls it made.</li>
          <li>Sealed approval receipts: who approved (a role label such as &ldquo;cafe-owner&rdquo;), when, and the SHA-256 fingerprint.</li>
          <li>PayPal identifiers: order, capture and dispute IDs, and the café&apos;s Vault payment token. Never card numbers or PayPal passwords.</li>
          <li>Dispute drafts, the merchant&apos;s decisions, verified PayPal webhook events and an append-only activity ledger.</li>
        </ul>
        <p>Data is kept in a Postgres database (or a local file when run on a laptop) on the server that runs RelayPay.</p>

        <h2>Who RelayPay shares data with</h2>
        <ul className="docs-list">
          <li>
            <strong>PayPal</strong> receives orders, the receipt fingerprint as <code>custom_id</code>, captures and dispute evidence, as required to process them.
          </li>
          <li>
            <strong>The AI model provider</strong> receives the request text, stock levels, catalog prices and, for disputes, the case details and receipt, so the
            agents can work. It receives no PayPal credentials.
          </li>
          <li>
            <strong>Channel3</strong>, when enabled, receives a product name to look up market prices.
          </li>
          <li>
            <strong>The owner alert channels</strong> (Discord, Slack, ntfy.sh, Zapier, or email through Resend), when enabled, receive alert titles, messages and a link back to RelayPay.
          </li>
          <li>
            <strong>Hosting</strong> (Render, and Neon for the database) stores and serves the app.
          </li>
        </ul>

        <h2>In your browser</h2>
        <p>RelayPay sets no tracking cookies and runs no analytics. It saves one setting in your browser&apos;s local storage: whether you chose light or dark mode.</p>

        <h2>Public receipt pages</h2>
        <p>
          Anyone who has a receipt&apos;s 64-character hash can open its verification page, which shows the receipt&apos;s contents. Share a hash only with people who
          should see that order.
        </p>

        <h2>Questions</h2>
        <p>
          Email <a href="mailto:hello@relaypay.example">hello@relaypay.example</a>.
        </p>
        <p className="muted small">Last updated November 2026.</p>
      </article>
    </PublicShell>
  );
}
