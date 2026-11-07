# RelayPay — approval receipts for AI-agent orders

A coffee supplier runs RelayPay to offer an **AI reordering service** to its café customers. The agent watches a
café's stock and proposes the next order. The **café owner approves** it, and that approval is sealed into a
**SHA-256 receipt** whose fingerprint travels with the PayPal payment as `custom_id`, so PayPal holds an independent
copy. If the payment is later disputed ("we never authorized this"), the **supplier** checks the receipt against
PayPal's copy and responds with a tamper-evident record instead of having little to show.

Built for the PayPal AI Hackathon. **PayPal sandbox only; no real money moves.**

| | |
|---|---|
| **Hosted demo** | `[paste Render URL here]` (the console is at `/app`) |
| **Video** | `[paste YouTube URL here]` |
| **Docs** | `/docs` on the hosted demo: the flow, every PayPal call, both agents, verifying a receipt yourself |
| **License** | MIT |

![The RelayPay console: the purchasing agent's proposal in a live order window, beside the guided walkthrough](docs/console.jpg)

## For judges: try it in two minutes

No PayPal login is needed. The café's PayPal is already saved with Vault on the hosted demo.

1. Open the hosted demo and choose **Open the live demo**.
2. **Purchases → send the request** in the purchasing agent box (orange arrow). The agent calls its tools and proposes an order. If nothing is running low, press **Run a café day** first.
3. On the new proposal, press **Café approves**. The approval is sealed into a receipt (SHA-256).
4. **Charge with PayPal.** A real sandbox order is created and captured, with the receipt's fingerprint as `custom_id`.
5. **Verify with PayPal.** RelayPay re-reads the order from PayPal; open **View receipt** to see the four checks.
6. **Disputes → Run sample.** The dispute agent checks the receipt against PayPal and drafts the response (labelled as a sample; nothing is sent).
7. In the receipt, open **Public verification page** to see what anyone holding the receipt can check.

The free hosting tier sleeps when idle, so the first visit can take about a minute to wake up.

---

## Who is who

| Role | In the story | In the PayPal sandbox |
|---|---|---|
| **Supplier** (merchant) | Runs RelayPay, gets paid, answers disputes | Your sandbox **Business** account (the REST app's credentials) |
| **Café** (customer) | Saves PayPal once, approves each order the agent proposes | Your sandbox **Personal** (buyer) account |
| **AI purchasing agent** | Proposes orders for the café; cannot pay | LLM with tool calls |
| **AI dispute agent** | Checks the receipt against PayPal and drafts the supplier's response | LLM with tool calls |

In the demo, the café's approval happens on the same screen; in production it would be the café's own portal.

## Why this exists

Agents are starting to order on people's behalf. When a payment is disputed as unauthorized, the merchant usually has
little to show: no record of what the agent proposed, who approved it, or whether the approved order is what was
charged. Nearly two-thirds of merchants in a PayPal-commissioned study of 498 US merchants say a liability framework for
agent-initiated purchases is urgently needed.

Dispute tools argue after the fact. RelayPay brings the signed-mandate idea (AP2) to PayPal merchants today and
creates the record **before the purchase**: the café's approval is sealed when it happens and its fingerprint is stored
inside the PayPal payment.

**What the receipt proves, precisely:** it existed when PayPal took the payment and has not changed since, and PayPal
holds an independent copy of its fingerprint. It is a tamper-evident approval record. It does not by itself prove
who clicked approve; that rests on the approval flow that created it.

![A public receipt page: the sealed approval receipt beside the Verify with PayPal checks](docs/receipt.jpg)

## The loop

```
1. Stock runs low            "Run a café day" uses up the café's inventory
2. Agent proposes            tool calls: low stock → inventory → budget → (Channel3 market price) → proposal
3. Café approves             price recomputed from the catalog, checks re-run, approval sealed (SHA-256)
4. Supplier charges          Orders v2 + the café's saved Vault token, custom_id = receipt fingerprint
5. Check against PayPal      re-read the order from PayPal, recompute the fingerprint, compare custom_id
6. Payment disputed          webhook or "Check PayPal for new disputes"
7. Dispute agent             dispute → receipt → timeline → PayPal capture → fingerprint check → decision
8. Supplier sends or refunds evidence PDF via provide-evidence, or accept-claim
```

## Screens (six) and public pages

Public pages: `/` (landing), `/docs` (how it works, PayPal APIs, verify a receipt yourself), `/verify` (look up a receipt by hash), `/r/<hash>` (a receipt's checks), `/privacy`, `/terms`.


| Screen | What it's for |
|---|---|
| **Overview** | Today's numbers, a live order window (the agent's latest proposal with its Approve / Charge / Verify buttons), the guided six-step walkthrough, recent activity |
| **Purchases** | Café stock, the agent's proposals with its reasoning, café approval, charge with PayPal |
| **Receipts** | Every sealed receipt from the moment the café approves, its PayPal payment state (not charged, captured), **Charge** or **Verify with PayPal**, reconcile, CSV |
| **Disputes** | Import or sync PayPal disputes, advance them in the sandbox, the agent's verdict, evidence checks, the response and a preview of the evidence PDF |
| **Ledger** | Who did what and when (agent, café, supplier, PayPal), plus verified PayPal webhooks |
| **Settings** | Read-only status: Vault (locked once connected), approval rules, catalog, connections |

## What is real

| Piece | How it works |
|---|---|
| **Purchasing agent** | Real tool-calling loop over an OpenAI-compatible API. The model picks each tool; the backend runs it. Tools: `get_low_stock_products`, `search_catalog`, `check_inventory`, `check_budget`, `compare_market_prices` (Channel3), `propose_purchase`. JSON-mode tool calling if `tools` is rejected; labelled deterministic fallback without a key. |
| **Dispute agent** | Tools: `get_dispute`, `get_receipt`, `get_event_timeline`, `get_paypal_confirmation` (re-reads the capture from PayPal), `verify_hash`, `decide_case`. A guardrail never recommends contesting unless the fingerprint matches PayPal's own record. |
| **Approval record** | Sealed on the café's approval: product, quantity, amount, rationale, approver, time, agent ID, model, prompt hash, the checks that ran (catalog price, daily limit, extra confirmation over $100), and the Channel3 market check. Fingerprint = SHA-256 of the canonical JSON (fits PayPal's 127-char `custom_id`). |
| **Inventory** | Stock, reorder points and targets persist. A charged order adds its quantity once; "Run a café day" consumes daily usage. |
| **Charge** | `POST /v2/checkout/orders` with `payment_source.paypal.vault_id` and `custom_id`; explicit `/capture` if PayPal returns `APPROVED`; only a `COMPLETED` capture counts. `PayPal-Request-Id` makes create and capture idempotent. |
| **Verification** | Re-reads the order from PayPal and checks: receipt unchanged, `custom_id` equals the fingerprint, amount matches, capture complete. `/r/<hash>` shows the same checks publicly and flags altered receipts. |
| **Dispute record** | PayPal's copy of the fingerprint is always read from PayPal: the dispute's `disputed_transactions[].custom`, else the disputed capture's `custom_id`, else the order. Re-verified against a fresh read before the irreversible submission. |
| **Evidence PDF** | Fingerprint check, Vault consent time, café approval, PayPal's capture confirmation, timeline and response; sanitized, wrapped and paginated. |
| **Webhooks** | Signature verified; unsigned events rejected; capture events checked against amount, currency, `custom_id` and capture ID; dispute drafting runs after PayPal is acknowledged. |
| **Reliability** | Atomic writes (Postgres row lock or a file write queue), database-backed rate limits, in-flight locks on irreversible actions, Vault locked once connected, no secrets in the browser, unit tests. |

## PayPal APIs used

- **Vault v3**: setup tokens, payment tokens (return URL exchanges automatically)
- **Orders v2**: create with `vault_id` + `custom_id`, get, capture
- **Payments v2**: get capture (PayPal's copy of `custom_id`)
- **Disputes v1**: list, show, provide-evidence (PDF), accept-claim, escalate, sandbox require-evidence, sandbox create (`PayPal-Auth-Assertion`)
- **Webhooks**: verify-webhook-signature; `PAYMENT.CAPTURE.COMPLETED`, `CUSTOMER.DISPUTE.CREATED/UPDATED/RESOLVED`
- **Transaction Search**: reconciliation (counts only)

The agents never hold PayPal credentials and never move money. Live PayPal is refused unless `ALLOW_LIVE=true`.

## AI

`subconscious/glm-5.3-marathon` via `https://api.subconscious.dev/v1` (OpenAI-compatible; change with `LLM_BASE_URL` /
`LLM_MODEL`). Two agents with visible tool traces; the purchase prompt's hash is sealed into each receipt.

## Sponsors

| Sponsor | Use | Turn on |
|---|---|---|
| **AG Grid** (Community 32) | Receipts, ledger and webhook tables: quick filter, CSV export, external actor filter, custom renderers, pinned actions, auto-height rows, pagination | always on |
| **Render** | Blueprint with a web service | deploy |
| **Channel3** | Market price check sealed into the receipt | `CHANNEL3_API_KEY` |
| **Zapier** | Alerts when the café's approval is needed, an order is charged, a dispute arrives, evidence is sent | `ZAPIER_WEBHOOK_URL` |

---

## Run it locally (about 5 minutes)

Requires Node 20+ (Node 22.18+ for `npm test`). No database or webhook needed locally.

1. `git clone [paste GitHub repo URL here] && cd relaypay`
2. `cp .env.example .env` and fill in `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` (sandbox), `LLM_API_KEY` and
   `NEXT_PUBLIC_BASE_URL=http://localhost:3000`. The sandbox app needs **Save payment methods** (Vault) enabled.
3. `npm install` then `npm run dev` → http://localhost:3000 (landing page) and http://localhost:3000/app (the console)
4. Follow the **guided walkthrough** on Overview:
   - **Settings → Create approval link → Open PayPal approval**, log in as the café (sandbox Personal account), approve.
   - **Purchases → Ask the agent to restock → Café approves · seal receipt → Charge with PayPal**
   - **Receipts → Verify**
   - **Disputes → Run sample** (a labelled sample; nothing is sent)

Scripts: `npm run check` (types + tests), `npm run seed` (spare charged orders), `npm run reset` (wipe local data).

### A real sandbox dispute (for the video)

1. `npm run seed` for spare charges; evidence can only be submitted once.
2. Log in to sandbox.paypal.com as the **café** (buyer), open a RelayPay payment, **Report a problem**.
3. RelayPay → **Disputes → Check PayPal for new disputes** (or wait for the webhook) → **Advance in sandbox** until
   PayPal is waiting for evidence → **Approve this response → Send evidence to PayPal**. Record it the first time.

## Deploy on Render

1. Push the `relaypay/` folder as the repository root, then Render → **New → Blueprint**.
2. Set `DATABASE_URL` (Neon recommended: Render's free Postgres expires after about 30 days, which would fall inside
   judging), `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `LLM_API_KEY`, `NEXT_PUBLIC_BASE_URL`, and optionally
   `CHANNEL3_API_KEY`, `ZAPIER_WEBHOOK_URL`, `SANDBOX_BUYER_EMAIL`.
3. Register `https://<your-app>/api/webhooks/paypal` in the PayPal dashboard for `PAYMENT.CAPTURE.COMPLETED` and
   `CUSTOMER.DISPUTE.*`; set its ID as `PAYPAL_WEBHOOK_ID`.
4. Connect Vault once (Settings, as the café). It's then locked, and judges can charge orders without logging in.

## Environment variables

| Variable | Needed | Purpose |
|---|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | yes | Sandbox REST app (the supplier) |
| `PAYPAL_ENVIRONMENT` | yes | `sandbox` (live refused unless `ALLOW_LIVE=true`) |
| `LLM_API_KEY` | for the live agent | OpenAI-compatible key; labelled fallback without it |
| `LLM_BASE_URL`, `LLM_MODEL` | no | Default subconscious.dev / `subconscious/glm-5.3-marathon` |
| `NEXT_PUBLIC_BASE_URL` | yes | Vault return URL and notification links |
| `DATABASE_URL` | when deployed | Postgres; local default is `data/db.json` |
| `PAYPAL_WEBHOOK_ID` | when deployed | Webhook signature verification |
| `SANDBOX_BUYER_EMAIL` | no | Open sandbox disputes from RelayPay (email only, never a password) |
| `CHANNEL3_API_KEY` | no | Market price check |
| `ZAPIER_WEBHOOK_URL` | no | Alerts (`https://hooks.zapier.com/…`) |
| `ALLOW_VAULT_RESET` | no | Allow reconnecting Vault after it's locked |
| `ALLOW_SIMULATOR` | no | Accept unsigned simulator webhooks (keep `false` when public) |
| `DISABLE_RATE_LIMITS` | no | Local development only |
| `ALLOW_LIVE` | no | Safety switch for live PayPal |

## Code map

```
public/index.html, public/assets/ landing page at / (static, served by a rewrite)
app/app/page.tsx, app/globals.css  the console at /app, theme (dark default + light)
app/r/[hash]/page.tsx              public receipt verification
app/docs, app/verify,              docs, receipt lookup, privacy, terms, 404
  app/privacy, app/terms           (components/PublicShell.tsx: shared header and footer)
app/api/                           intents, orders, disputes, inventory, vault, webhooks, notify, ledger
components/useRelayPay.ts          data, polling, every action
components/views/                  the six screens
components/kit.tsx                 the landing page's UI pieces in React (window, chat, checklist, receipt document)
lib/agents.ts                      both tool-calling agents
lib/policy.ts, lib/receipts.ts     catalog, inventory and approval checks; canonical receipt + SHA-256 (unit tested)
lib/disputeService.ts              dispute pipeline (draft, webhook, sync, sandbox create)
lib/store.ts                       Postgres or file storage with atomic writes
lib/channel3.ts, lib/notify.ts     sponsors
lib/paypal/                        client, orders, vault, disputes, reporting
tests/, scripts/                   node:test suites; seed and reset
docs/                              README screenshots
```

## Limitations

- Sandbox only. No login: anyone with the URL can act as both café and supplier, which suits a demo, not production.
- The receipt is tamper-evident, not a signature: it shows the record existed at payment time and is unchanged.
- Evidence submission is one-shot. Creating a dispute from RelayPay needs PayPal's dispute-create permission; the buyer-account route always works.
- Transaction Search indexes payments with a delay of up to a few hours.
- Zapier alerts need a Zapier plan that includes Webhooks by Zapier; without one, RelayPay works the same and simply sends no alerts.

## License

MIT — see [LICENSE](LICENSE).
