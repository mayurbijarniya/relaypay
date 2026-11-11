"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRelayPay } from "@/components/useRelayPay";
import { Button, Callout, ConfirmDialog, Dot, Spinner, ThemeToggle, ToastStack } from "@/components/ui";
import {
  IconBag,
  IconBell,
  IconHome,
  IconList,
  IconMenu,
  IconReceipt,
  IconRefresh,
  IconScale,
  IconSettings,
  IconX,
  LogoMark,
} from "@/components/icons";
import { ReceiptDrawer } from "@/components/ReceiptDrawer";
import { OverviewView } from "@/components/views/Overview";
import { AgentMark, BrandTile } from "@/components/kit";
import { PurchasesView } from "@/components/views/Purchases";
import { ReceiptsView } from "@/components/views/Receipts";
import { DisputesView } from "@/components/views/Disputes";
import { LedgerView } from "@/components/views/Ledger";
import { SettingsView } from "@/components/views/Settings";
import { VIEWS, type View } from "@/components/views/types";
import { needsDecision, type AnyRecord } from "@/lib/format";

const PAGE: Record<View, { title: string; subtitle: string }> = {
  overview: {
    title: "Overview",
    subtitle: "Your AI agent reorders supplies for the café. The café approves every order. PayPal holds the fingerprint of each approval.",
  },
  purchases: {
    title: "Purchases",
    subtitle: "The agent proposes the café's next order. The café owner approves it, then you charge it through PayPal.",
  },
  receipts: {
    title: "Receipts",
    subtitle: "Every receipt the café has sealed, from approval to the PayPal payment that carries its fingerprint.",
  },
  disputes: {
    title: "Disputes",
    subtitle: "When a payment is disputed, the agent checks the café's approval receipt against PayPal and drafts your response. You decide what is sent.",
  },
  ledger: {
    title: "Ledger",
    subtitle: "Who did what, and when: the AI agent, the café, you (the supplier) and PayPal.",
  },
  settings: {
    title: "Settings",
    subtitle: "PayPal Vault, spend policy, catalog and connections.",
  },
};

function useHashView(): [View, (v: View) => void] {
  const [view, setViewState] = useState<View>("overview");
  useEffect(() => {
    const read = () => {
      const hash = window.location.hash.replace("#", "") as View;
      setViewState(VIEWS.includes(hash) ? hash : "overview");
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const setView = useCallback((v: View) => {
    if (window.location.hash !== `#${v}`) window.history.pushState(null, "", `#${v}`);
    setViewState(v);
    window.scrollTo({ top: 0 });
  }, []);
  return [view, setView];
}

export default function Console() {
  const app = useRelayPay();
  const [view, setView] = useHashView();
  const [navOpen, setNavOpen] = useState(false);
  const [receiptIntent, setReceiptIntent] = useState<AnyRecord | null>(null);
  const data = app.data;

  // Each screen gets its own browser-tab title.
  useEffect(() => {
    document.title = `${PAGE[view].title} · RelayPay`;
  }, [view]);

  const go = useCallback(
    (v: View) => {
      setView(v);
      setNavOpen(false);
    },
    [setView]
  );

  // Keep an open receipt in sync with polling and actions.
  const liveReceipt = receiptIntent && data ? data.intents.find((i) => i.id === receiptIntent.id) || receiptIntent : null;

  const nav: Array<{ view: View; label: string; icon: ReactNode; badge?: number }> = [
    { view: "overview", label: "Overview", icon: <IconHome /> },
    {
      view: "purchases",
      label: "Purchases",
      icon: <IconBag />,
      badge: data?.intents.filter((i) => i.status === "PROPOSED" || i.status === "APPROVED").length,
    },
    { view: "receipts", label: "Receipts", icon: <IconReceipt /> },
    {
      view: "disputes",
      label: "Disputes",
      icon: <IconScale />,
      badge: data?.disputes.filter(needsDecision).length,
    },
    { view: "ledger", label: "Ledger", icon: <IconList /> },
    { view: "settings", label: "Settings", icon: <IconSettings /> },
  ];

  return (
    <div className={`shell ${navOpen ? "nav-open" : ""}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <LogoMark />
          <div>
            <strong>RelayPay</strong>
            <span>Approval receipts for AI orders</span>
          </div>
          <button type="button" className="icon-btn sidebar-close" aria-label="Close menu" onClick={() => setNavOpen(false)}>
            <IconX />
          </button>
        </div>

        <nav className="nav">
          {nav.map((item) => (
            <a
              key={item.view}
              href={`#${item.view}`}
              className={`nav-item ${view === item.view ? "active" : ""}`}
              aria-current={view === item.view ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                go(item.view);
              }}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
              {!!item.badge && <span className="nav-badge">{item.badge}</span>}
            </a>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className="sidebar-foot-title">Status</span>
          <ul className="status-list">
            <li>
              <BrandTile name="paypal" size="sm" />
              <span className="k-status-label">PayPal {data?.config.environment === "live" ? "live" : "sandbox"}</span>
              <Dot tone={data?.config.paypalConfigured ? "ok" : "bad"} />
            </li>
            <li>
              <AgentMark size={22} />
              <span className="k-status-label">{data?.config.llmConfigured ? "AI agent live" : "AI agent offline"}</span>
              <Dot tone={data?.config.llmConfigured ? "ok" : "warn"} />
            </li>
            <li>
              <BrandTile name="paypal" size="sm" />
              <span className="k-status-label">{data?.vault.active ? "Vault connected" : "Vault not connected"}</span>
              <Dot tone={data?.vault.active ? "ok" : "warn"} />
            </li>
            <li>
              <BrandTile name="paypal" size="sm" />
              <span className="k-status-label">{data?.config.webhookConfigured ? "Webhooks verified" : "Webhooks not set"}</span>
              <Dot tone={data?.config.webhookConfigured ? "ok" : "neutral"} />
            </li>
            <li>
              <span className="k-status-glyph">C3</span>
              <span className="k-status-label">{data?.config.channel3 ? "Channel3 market check" : "Channel3 off"}</span>
              <Dot tone={data?.config.channel3 ? "ok" : "neutral"} />
            </li>
            <li>
              <span className="k-status-glyph">
                <IconBell size={13} />
              </span>
              <span className="k-status-label">{data?.config.alerts ? `${data.config.alertsChannel} alerts on` : "Owner alerts off"}</span>
              <Dot tone={data?.config.alerts ? "ok" : "neutral"} />
            </li>
          </ul>
          <ThemeToggle />
          <nav className="sidebar-links" aria-label="RelayPay site">
            <a href="/">Home</a>
            <a href="/docs">Docs</a>
            <a href="/verify">Verify a receipt</a>
          </nav>
          <p className="sidebar-note">{data?.config.sandbox === false ? "Live PayPal." : "PayPal sandbox. No real money moves."}</p>
        </div>
      </aside>
      <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />

      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" aria-label="Open menu" onClick={() => setNavOpen(true)}>
            <IconMenu />
          </button>
          <div className="topbar-text">
            <h1>{PAGE[view].title}</h1>
            <p>{PAGE[view].subtitle}</p>
          </div>
          <div className="topbar-actions">
            <Button
              size="sm"
              variant="ghost"
              icon={<IconRefresh size={15} />}
              loading={app.busy.refresh}
              onClick={() => void app.actions.refresh()}
            >
              Refresh
            </Button>
          </div>
        </header>

        <main className="content" id="content">
          {!data ? (
            app.loadError ? (
              <Callout tone="bad" title="RelayPay couldn't load its data">
                {app.loadError}
              </Callout>
            ) : (
              <div className="page-loading">
                <Spinner size={18} /> Loading RelayPay…
              </div>
            )
          ) : (
            <>
              {app.loadError && (
                <Callout tone="warn" title="Showing the last data RelayPay loaded">
                  {app.loadError}
                </Callout>
              )}
              {view === "overview" && <OverviewView app={app} go={go} openReceipt={setReceiptIntent} />}
              {view === "purchases" && <PurchasesView app={app} openReceipt={setReceiptIntent} />}
              {view === "receipts" && <ReceiptsView app={app} openReceipt={setReceiptIntent} />}
              {view === "disputes" && <DisputesView app={app} />}
              {view === "ledger" && <LedgerView app={app} />}
              {view === "settings" && <SettingsView app={app} />}
            </>
          )}
        </main>
      </div>

      <ReceiptDrawer app={app} intent={liveReceipt} onClose={() => setReceiptIntent(null)} />
      <ConfirmDialog request={app.confirm} onClose={app.closeConfirm} />
      <ToastStack toasts={app.toasts} onDismiss={app.dismissToast} />
    </div>
  );
}
