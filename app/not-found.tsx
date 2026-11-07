import { PublicShell } from "@/components/PublicShell";

export default function NotFound() {
  return (
    <PublicShell>
      <div className="pub-wrap legal notfound">
        <p className="docs-kicker">404</p>
        <h1>This page doesn&apos;t exist</h1>
        <p className="docs-lead">The link may be old, or the address mistyped.</p>
        <div className="notfound__actions">
          <a className="btn btn-primary btn-md" href="/app">
            Open the console
          </a>
          <a className="btn btn-secondary btn-md" href="/verify">
            Verify a receipt
          </a>
        </div>
      </div>
    </PublicShell>
  );
}
