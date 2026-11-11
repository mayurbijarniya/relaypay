import type { Metadata } from "next";
import { PublicShell } from "@/components/PublicShell";
import { AgentMark, BrandTile, Code, Lit } from "@/components/kit";

export const metadata: Metadata = {
  title: "Docs · RelayPay",
  description: "How RelayPay seals a café's approval into a receipt, sends its fingerprint to PayPal as custom_id, and answers disputes from it.",
};

const TOC = [
  ["overview", "What RelayPay does"],
  ["flow", "The flow, step by step"],
  ["receipt", "The approval receipt"],
  ["verify-yourself", "Verify a receipt yourself"],
  ["paypal", "PayPal APIs used"],
  ["agents", "The two AI agents"],
  ["integrations", "Channel3, alerts and the stack"],
  ["limits", "What a receipt does and doesn't show"],
  ["run", "Run it locally"],
] as const;

const STEPS = [
  ["The café saves its PayPal once", "PayPal Vault stores the café's payment method. RelayPay keeps only the vault token, never card or login details."],
  ["The agent proposes", "The purchasing agent reads stock, the budget and catalog prices with tools, then proposes an order. It has no PayPal credentials and cannot pay."],
  ["The café approves", "The approval, the policy checks that ran and the agent's reasoning are sealed into a receipt and fingerprinted with SHA-256."],
  ["PayPal is charged with the fingerprint", "RelayPay creates a PayPal order with the vault token and puts the fingerprint in custom_id, then captures it. PayPal now holds an independent copy."],
  ["Anyone can check it", "Verify re-reads the order from PayPal and compares custom_id, the amount and the capture with the receipt."],
  ["Disputes are answered from the record", "The dispute agent compares the receipt with PayPal's copy and drafts a response. The merchant decides what, if anything, is sent."],
];

const APIS: Array<[string, string, string]> = [
  ["Vault v3", "POST /v3/vault/setup-tokens · POST /v3/vault/payment-tokens", "The café saves its PayPal once, without a redirect on later orders."],
  ["Orders v2", "POST /v2/checkout/orders · POST /v2/checkout/orders/{id}/capture · GET /v2/checkout/orders/{id}", "Charge with vault_id and custom_id = receipt fingerprint; re-read it to verify."],
  ["Payments v2", "GET /v2/payments/captures/{id}", "Confirm the capture's status and amount."],
  ["Disputes v1", "GET /v1/customer/disputes · GET /v1/customer/disputes/{id} · POST …/provide-evidence · POST …/accept-claim", "Import cases, read PayPal's view, send evidence or refund."],
  ["Webhooks", "POST /v1/notifications/verify-webhook-signature", "Every incoming event's signature is verified before it is stored."],
  ["Transaction Search", "GET /v1/reporting/transactions", "Reconcile captures against PayPal's reporting ledger."],
];

const PURCHASE_TOOLS = ["get_low_stock_products", "search_catalog", "check_inventory", "check_budget", "compare_market_prices", "propose_purchase"];
const DISPUTE_TOOLS = ["get_dispute", "get_receipt", "get_event_timeline", "get_paypal_confirmation", "verify_hash", "decide_case"];

const ENV: Array<[string, string]> = [
  ["PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET", "Your PayPal sandbox REST app. Required."],
  ["PAYPAL_ENVIRONMENT", "sandbox (default)."],
  ["LLM_API_KEY, LLM_BASE_URL, LLM_MODEL", "Any OpenAI-compatible chat API with tool calling. Without a key a labelled offline fallback runs."],
  ["PAYPAL_WEBHOOK_ID", "Optional. Turns on signed webhooks; disputes can always be imported by ID."],
  ["SANDBOX_BUYER_EMAIL", "Optional. Lets RelayPay open sandbox disputes for testing."],
  ["CHANNEL3_API_KEY", "Optional. Market price check for the agent."],
  ["ALERT_WEBHOOK_URL, NEXT_PUBLIC_BASE_URL", "Optional. Owner alerts to a Discord, Slack or ntfy.sh URL, with links back to the app."],
  ["DATABASE_URL", "Optional. Postgres (Neon or Render). Without it, data lives in data/db.json."],
];

export default function DocsPage() {
  return (
    <PublicShell current="docs">
      <div className="pub-wrap docs">
        <aside className="docs-toc" aria-label="On this page">
          <span className="docs-toc__title">On this page</span>
          {TOC.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </aside>

        <article className="docs-body">
          <header className="docs-head">
            <p className="docs-kicker">Docs</p>
            <h1>How RelayPay works</h1>
            <p className="docs-lead">
              A coffee supplier runs an AI agent that reorders for a café. The café approves each order, RelayPay seals that approval into a receipt, and PayPal keeps
              the receipt&apos;s fingerprint on the payment. When a payment is disputed, the merchant answers from that record.
            </p>
          </header>

          <section id="overview" className="docs-section">
            <h2>What RelayPay does</h2>
            <p>
              AI agents can now place orders, but when a buyer later says &ldquo;I never approved that&rdquo;, the merchant has little to show. RelayPay records the
              approval at the moment it happens and puts a fingerprint of it into the PayPal payment itself, so there is an independent copy that RelayPay
              cannot quietly rewrite.
            </p>
            <div className="docs-cards">
              <div className="docs-card">
                <AgentMark size={28} />
                <h3>The agent proposes</h3>
                <p>It reads stock, budget and prices with tools. It never holds PayPal credentials and cannot pay.</p>
              </div>
              <div className="docs-card">
                <span className="k-av" data-tone="2" aria-hidden="true">
                  CA
                </span>
                <h3>The café approves</h3>
                <p>The approval is sealed into a receipt and fingerprinted with SHA-256.</p>
              </div>
              <div className="docs-card">
                <BrandTile name="paypal" />
                <h3>PayPal keeps a copy</h3>
                <p>The fingerprint rides on the PayPal order as custom_id.</p>
              </div>
            </div>
          </section>

          <section id="flow" className="docs-section">
            <h2>The flow, step by step</h2>
            <ol className="docs-steps">
              {STEPS.map(([title, body], i) => (
                <li key={title}>
                  <span className="docs-steps__n">{i + 1}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section id="receipt" className="docs-section">
            <h2>The approval receipt</h2>
            <p>
              The receipt is finalised only when the café approves. Its canonical JSON holds the order (intent ID, product, quantity, amount, currency), the agent&apos;s
              rationale and alternatives, who approved and when, the agent ID, model, policy version, prompt hash, the policy checks that ran, whether a high-value
              order was confirmed, and the Channel3 market check when one ran.
            </p>
            <p>
              RelayPay hashes that exact text with SHA-256. The 64-character hex result is the receipt&apos;s fingerprint and is sent to PayPal as the order&apos;s{" "}
              <code>custom_id</code>. Change one character of the receipt and the fingerprint no longer matches PayPal&apos;s copy.
            </p>
          </section>

          <section id="verify-yourself" className="docs-section">
            <h2>Verify a receipt yourself</h2>
            <p>
              Open a receipt&apos;s public page (<a href="/verify">Verify a receipt</a>), expand <em>Canonical receipt</em> and copy the text exactly. Then:
            </p>
            <Lit tone="sage" className="docs-lit">
              <Code
                file="verify.mjs"
                lines={[
                  { code: <><span className="k">import</span> {"{ createHash }"} <span className="k">from</span> <span className="s">&quot;crypto&quot;</span>;</> },
                  { code: <><span className="k">const</span> text = <span className="s">`…canonical receipt…`</span>;</> },
                  { code: <><span className="k">const</span> hash = <span className="f">createHash</span>(<span className="s">&quot;sha256&quot;</span>).<span className="f">update</span>(text).<span className="f">digest</span>(<span className="s">&quot;hex&quot;</span>);</>, mark: true },
                  { code: <><span className="c">{"// equal to the receipt hash, and to PayPal's custom_id"}</span></> },
                ]}
                hint="Compare with purchase_units[0].custom_id from GET /v2/checkout/orders/{id}."
              />
            </Lit>
            <p>
              The merchant can read <code>custom_id</code> from the PayPal order with the Orders API. RelayPay&apos;s <em>Verify with PayPal</em> button does exactly that,
              and also checks the amount and the capture.
            </p>
          </section>

          <section id="paypal" className="docs-section">
            <h2>PayPal APIs used</h2>
            <p>All calls go from RelayPay&apos;s server. The agents call RelayPay tools, never PayPal directly.</p>
            <div className="docs-table">
              <table className="table">
                <thead>
                  <tr>
                    <th>API</th>
                    <th>Endpoints</th>
                    <th>What for</th>
                  </tr>
                </thead>
                <tbody>
                  {APIS.map(([api, endpoints, why]) => (
                    <tr key={api}>
                      <td>
                        <span className="docs-api">
                          <BrandTile name="paypal" size="sm" />
                          {api}
                        </span>
                      </td>
                      <td>
                        <code className="docs-endpoints">{endpoints}</code>
                      </td>
                      <td>{why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="agents" className="docs-section">
            <h2>The two AI agents</h2>
            <p>
              Both agents use OpenAI-compatible tool calling. Every tool call is recorded with its input, output, time and source (model or fallback), and shown in
              the console. If no LLM key is set, a deterministic fallback runs and every step is labelled as fallback.
            </p>
            <div className="docs-cards docs-cards--2">
              <div className="docs-card">
                <AgentMark size={28} />
                <h3>Purchasing agent</h3>
                <p>Proposes the café&apos;s next order from the supplier catalog. RelayPay recomputes every price and checks the café&apos;s rules again before charging.</p>
                <ul className="docs-tools">
                  {PURCHASE_TOOLS.map((t) => (
                    <li key={t}>
                      <code>{t}</code>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="docs-card">
                <AgentMark size={28} />
                <h3>Dispute agent</h3>
                <p>Reads the PayPal case, compares the receipt with PayPal&apos;s copy and drafts a response. It recommends contesting only when the fingerprint matches PayPal.</p>
                <ul className="docs-tools">
                  {DISPUTE_TOOLS.map((t) => (
                    <li key={t}>
                      <code>{t}</code>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <section id="integrations" className="docs-section">
            <h2>Channel3, alerts and the stack</h2>
            <ul className="docs-list">
              <li>
                <strong>Channel3</strong> gives the purchasing agent a market price check: the supplier&apos;s price against the median of live retail offers. The result is
                sealed into the receipt.
              </li>
              <li>
                <strong>Owner alerts</strong> go to Discord, Slack or ntfy.sh (a Zapier Catch Hook also works) when an order needs approval, a payment is captured, or a dispute arrives or is answered.
              </li>
              <li>
                <strong>AG Grid</strong> draws the receipts and ledger tables, with search, sorting and CSV export.
              </li>
              <li>
                <strong>Next.js</strong> on <strong>Render</strong>, with <strong>Postgres</strong> on Neon in production.
              </li>
            </ul>
          </section>

          <section id="limits" className="docs-section">
            <h2>What a receipt does and doesn&apos;t show</h2>
            <p>
              When a receipt matches PayPal&apos;s copy, it shows the receipt existed at payment time and has not changed since: it is tamper-evident, and PayPal holds an
              independent copy of its fingerprint. It records who RelayPay says approved, and when.
            </p>
            <p>
              It does not prove who was physically at the keyboard, and it does not decide a dispute. PayPal decides; RelayPay strengthens the merchant&apos;s response.
            </p>
          </section>

          <section id="run" className="docs-section">
            <h2>Run it locally</h2>
            <p>
              Node 20 or later. Clone the repository, run <code>npm install</code>, create <code>.env</code> from <code>.env.example</code>, then <code>npm run dev</code>{" "}
              and open <code>localhost:3000</code>. The console is at <code>/app</code>.
            </p>
            <div className="docs-table">
              <table className="table">
                <thead>
                  <tr>
                    <th>Variable</th>
                    <th>What it does</th>
                  </tr>
                </thead>
                <tbody>
                  {ENV.map(([name, what]) => (
                    <tr key={name}>
                      <td>
                        <code>{name}</code>
                      </td>
                      <td>{what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted">PayPal sandbox only. No real money moves.</p>
          </section>
        </article>
      </div>
    </PublicShell>
  );
}
