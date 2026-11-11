"use client";

import { useState, type ReactNode } from "react";
import { Button, Card, CardHeader, Pill } from "@/components/ui";
import { AgentMark, BrandTile, Lit, ProductTile, Window } from "@/components/kit";
import { IconBell, IconCheck, IconExternal, IconRefresh } from "@/components/icons";
import { dateTime, money } from "@/lib/format";
import type { RelayPay } from "@/components/useRelayPay";

export function SettingsView({ app }: { app: RelayPay }) {
  const data = app.data!;
  const vault = data.vault;
  const pending = !vault.active && (vault.pendingSetupToken || !!app.vaultLink);
  const config = data.config;

  return (
    <div className="settings-grid">
      <Card className="settings-vault">
        <CardHeader
          icon={<BrandTile name="paypal" size="sm" />}
          title="PayPal Vault"
          subtitle="The café saves its PayPal with you once, so orders it approves can be charged without a redirect."
          actions={vault.active ? <Pill tone="ok">Connected</Pill> : pending ? <Pill tone="warn">Waiting for approval</Pill> : <Pill tone="neutral">Not connected</Pill>}
        />
        {vault.active ? (
          <Lit tone="sage" className="vault-lit">
          <div className="vault-connected">
            <BrandTile name="paypal" size="lg" label="PayPal" />
            <div>
              <strong>Payment method saved</strong>
              <p className="muted">
                Vault token {vault.vaultIdPreview} · connected {dateTime(vault.approvedAt)}. Orders the café approves are charged with it directly.
              </p>
              {!data.config.vaultResetAllowed && (
                <p className="muted small">Locked for the demo, so nobody can replace it. To reconnect, set ALLOW_VAULT_RESET=true on the server.</p>
              )}
            </div>
            {data.config.vaultResetAllowed && (
              <Button size="sm" variant="ghost" loading={app.busy["vault-setup"]} onClick={() => void app.actions.vaultSetup()}>
                Reconnect
              </Button>
            )}
          </div>
          </Lit>
        ) : (
          <ol className="vault-steps">
            <li className={app.vaultLink || vault.pendingSetupToken ? "done" : "current"}>
              <span className="vault-step-n">{app.vaultLink || vault.pendingSetupToken ? <IconCheck size={13} /> : 1}</span>
              <div>
                <strong>Create a PayPal approval link</strong>
                <p>RelayPay asks PayPal for a one-time setup token.</p>
                {!app.vaultLink && (
                  <Button variant="primary" loading={app.busy["vault-setup"]} onClick={() => void app.actions.vaultSetup()}>
                    {vault.pendingSetupToken ? "Create a new link" : "Create approval link"}
                  </Button>
                )}
              </div>
            </li>
            <li className={app.vaultLink ? "current" : ""}>
              <span className="vault-step-n">2</span>
              <div>
                <strong>Approve in PayPal</strong>
                <p>Log in as the café, using your PayPal sandbox buyer (Personal) account, and agree to save PayPal.</p>
                {app.vaultLink && (
                  <Button variant="primary" href={app.vaultLink} external icon={<IconExternal size={15} />}>
                    Open PayPal approval
                  </Button>
                )}
              </div>
            </li>
            <li className={pending ? "current" : ""}>
              <span className="vault-step-n">3</span>
              <div>
                <strong>Come back here</strong>
                <p>PayPal returns you to RelayPay and the payment method is saved automatically.</p>
                {pending && (
                  <Button size="sm" variant="ghost" loading={app.busy["vault-exchange"]} onClick={() => void app.actions.vaultExchange()}>
                    I approved it, finish setup
                  </Button>
                )}
              </div>
            </li>
          </ol>
        )}
      </Card>

      {config.resetEnabled && <ResetDemo app={app} />}

      <div className="settings-col">
      <Card>
        <CardHeader title="Café approval rules" subtitle={`Version ${data.policy.version}. Checked before the café approves and again before charging. The checks that ran become part of the café's sealed approval record.`} />
        <div className="policy-tiles">
          <div>
            <span>Café daily limit</span>
            <strong>{money(data.policy.dailyCap)}</strong>
            <small>{money(data.policy.remainingToday)} left today</small>
          </div>
          <div>
            <span>Extra confirmation</span>
            <strong>over {money(data.policy.highValueThreshold)}</strong>
            <small>the café owner ticks a box</small>
          </div>
          <div>
            <span>Prices</span>
            <strong>Catalog only</strong>
            <small>the agent can't set one</small>
          </div>
        </div>
      </Card>

      <Window crumb={["Settings", "Supplier catalog"]} meta="USD">
        <p className="k-win__intro">The only products the agent may propose, with the stock rules it follows.</p>
        <div className="table-scroll k-win__grid">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Unit price</th>
                <th className="num">On hand</th>
                <th className="num">Reorder at</th>
                <th className="num">Target</th>
              </tr>
            </thead>
            <tbody>
              {data.inventory.map((item) => (
                <tr key={item.product}>
                  <td>
                    <span className="cell-product">
                      <ProductTile name={item.product} size="sm" />
                      {item.product}
                    </span>
                  </td>
                  <td className="num">{money(item.unitPrice)}</td>
                  <td className="num">{item.low ? <Pill tone="warn">{item.onHand} · low</Pill> : item.onHand}</td>
                  <td className="num">{item.reorderPoint}</td>
                  <td className="num">{item.parLevel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Window>
      </div>

      <div className="settings-col">
      <Card>
        <CardHeader title="Connections" subtitle="Live status of the services RelayPay depends on. No secret values are shown." />
        <ul className="k-conn">
          <Connection
            ok={config.paypalConfigured}
            mark={<BrandTile name="paypal" />}
            title="PayPal REST API"
            detail={config.paypalConfigured ? `${config.environment === "live" ? "Live" : "Sandbox"} · Orders v2, Vault v3, Disputes v1` : "PAYPAL_CLIENT_ID / SECRET missing"}
          />
          <Connection
            ok={config.llmConfigured}
            warn={!config.llmConfigured}
            mark={<AgentMark size={32} />}
            title="AI agent"
            detail={config.llmConfigured ? `${config.model} · tool calling` : "No LLM key · labelled offline fallback"}
          />
          <Connection
            ok={config.webhookConfigured}
            warn={!config.webhookConfigured}
            mark={<BrandTile name="paypal" />}
            status={config.webhookConfigured ? "Verified" : "Not set"}
            title="PayPal webhooks"
            detail={config.webhookConfigured ? "Signature verified at /api/webhooks/paypal" : "PAYPAL_WEBHOOK_ID not set · disputes can still be imported by ID"}
          />
          <Connection
            ok={config.channel3}
            warn={!config.channel3}
            mark={<span className="k-status-glyph k-status-glyph--lg">C3</span>}
            title="Channel3 market prices (sponsor)"
            detail={config.channel3 ? "On · the agent compares supplier prices with live retail offers" : "Off · set CHANNEL3_API_KEY to enable the market price check"}
          />
          <Connection
            ok={config.alerts}
            warn={!config.alerts}
            mark={<span className="k-status-glyph k-status-glyph--lg"><IconBell size={16} /></span>}
            title="Owner alerts (optional)"
            detail={config.alerts ? `On · approvals, payments and disputes go to ${config.alertsChannel}` : "Off · set ALERT_WEBHOOK_URL (Discord, Slack, ntfy.sh) or RESEND_API_KEY and ALERT_EMAIL_TO"}
            action={
              config.alerts ? (
                <Button size="sm" variant="ghost" icon={<IconBell size={14} />} loading={app.busy["notify-test"]} onClick={() => void app.actions.testNotification()}>
                  Send test
                </Button>
              ) : undefined
            }
          />
          <Connection
            ok={config.sandboxBuyerConfigured}
            warn={!config.sandboxBuyerConfigured}
            mark={<BrandTile name="paypal" />}
            status={config.sandboxBuyerConfigured ? "Set" : "Not set"}
            title="Sandbox buyer"
            detail={config.sandboxBuyerConfigured ? "Set · disputes can be opened from RelayPay (needs PayPal's dispute-create permission)" : "SANDBOX_BUYER_EMAIL not set · open test disputes from the buyer's account"}
          />
          <Connection
            ok
            mark={<BrandTile name={data.storage === "postgres" ? "neon" : "json"} />}
            status={data.storage === "postgres" ? "Postgres" : "Local file"}
            title="Storage"
            detail={data.storage === "postgres" ? "Postgres" : "Local JSON file (data/db.json)"}
          />
          <Connection
            ok={!config.simulatorEnabled}
            warn={config.simulatorEnabled}
            mark={<BrandTile name="log" />}
            status={config.simulatorEnabled ? "Enabled" : "Disabled"}
            title="Webhook simulator"
            detail={config.simulatorEnabled ? "Enabled · keep this off in production" : "Disabled · unsigned events are rejected"}
          />
        </ul>
      </Card>
      </div>
    </div>
  );
}

function ResetDemo({ app }: { app: RelayPay }) {
  const [code, setCode] = useState("");
  return (
    <Card className="settings-vault reset-card">
      <CardHeader
        icon={<IconRefresh size={16} />}
        title="Reset the demo"
        subtitle="Start the shared demo from a clean state before a recording or a fresh round of judging."
        actions={<Pill tone="warn">Team only</Pill>}
      />
      <div className="reset-lists">
        <div>
          <strong>Clears</strong>
          <ul>
            <li>Agent proposals and receipts</li>
            <li>Orders, disputes and webhook events</li>
            <li>The ledger and rate limits</li>
            <li>Stock, back to its starting levels</li>
          </ul>
        </div>
        <div>
          <strong>Keeps</strong>
          <ul>
            <li>The saved PayPal (Vault)</li>
            <li>All settings and connections</li>
            <li>Anything already in PayPal</li>
          </ul>
        </div>
      </div>
      <form
        className="reset-form"
        onSubmit={(e) => {
          e.preventDefault();
          void app.actions.resetDemo(code).then((ok) => ok && setCode(""));
        }}
      >
        <label htmlFor="reset-code">Team reset code</label>
        <div className="reset-form-row">
          <input
            id="reset-code"
            className="input"
            type="password"
            autoComplete="off"
            placeholder="Reset code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button type="submit" variant="danger" icon={<IconRefresh size={14} />} disabled={!code} loading={app.busy["reset-demo"]}>
            Reset demo
          </Button>
        </div>
        <p className="muted small">This can't be undone. The code is the ADMIN_RESET_TOKEN set on the server.</p>
      </form>
    </Card>
  );
}

function Connection({
  ok,
  warn,
  mark,
  status,
  title,
  detail,
  action,
}: {
  ok: boolean;
  warn?: boolean;
  mark: ReactNode;
  status?: string;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <li>
      {mark}
      <div className="k-conn__text">
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      {action}
      <Pill tone={ok ? "ok" : warn ? "warn" : "bad"}>{status || (ok ? "On" : warn ? "Off" : "Missing")}</Pill>
    </li>
  );
}
