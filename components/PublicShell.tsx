/**
 * Header and footer for RelayPay's public pages (docs, verify, privacy, terms,
 * a receipt's verification page). Matches the landing page at "/": the same
 * mark, the same links and the one orange action. No hooks, so it renders on
 * the server.
 */
import type { ReactNode } from "react";
import { LogoMark } from "@/components/icons";

const NAV = [
  { href: "/docs", label: "Docs" },
  { href: "/verify", label: "Verify a receipt" },
];

export function PublicShell({ children, current }: { children: ReactNode; current?: "docs" | "verify" | "privacy" | "terms" }) {
  return (
    <div className="pub">
      <header className="pub-header">
        <div className="pub-wrap pub-header__bar">
          <a href="/" className="pub-logo" aria-label="RelayPay home">
            <LogoMark size={28} />
            <span>RelayPay</span>
          </a>
          <nav className="pub-nav" aria-label="Main">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="pub-nav__link" aria-current={current && n.href === `/${current}` ? "page" : undefined}>
                {n.label}
              </a>
            ))}
          </nav>
          <a className="btn btn-primary btn-md" href="/app">
            Open the live demo
          </a>
        </div>
      </header>
      <main className="pub-main">{children}</main>
      <footer className="pub-footer">
        <div className="pub-wrap pub-footer__grid">
          <div className="pub-footer__brand">
            <a href="/" className="pub-logo">
              <LogoMark size={24} />
              <span>RelayPay</span>
            </a>
            <p>Approval receipts for AI orders on PayPal.</p>
          </div>
          <div className="pub-footer__col">
            <h2>Product</h2>
            <a href="/app">Console</a>
            <a href="/verify">Verify a receipt</a>
          </div>
          <div className="pub-footer__col">
            <h2>Resources</h2>
            <a href="/docs">Docs</a>
            <a href="/docs#paypal">PayPal APIs</a>
          </div>
          <div className="pub-footer__col">
            <h2>Legal</h2>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
          </div>
        </div>
        <div className="pub-wrap pub-footer__legal">
          <span>© 2026 RelayPay · PayPal sandbox only, no real money</span>
          <span>Product names and logos are trademarks of their owners</span>
        </div>
      </footer>
    </div>
  );
}
