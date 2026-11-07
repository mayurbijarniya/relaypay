/**
 * The landing page's UI pieces (public/assets/ui), rebuilt as React for the console:
 * window chrome, the agent chat, the "Verify with PayPal" checklist, the approval-receipt
 * document, a code pane, real brand icons, product tiles and lit grounds.
 *
 * No hooks here, so these render in server components (the public /r/[hash] page) too.
 * Styles: the "Landing kit" section of app/globals.css (k-* classes).
 */
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Marks and tiles
// ---------------------------------------------------------------------------

/** RelayPay's stack mark, as on the landing page's logo. */
export function StackMark({ size = 14 }: { size?: number }) {
  return (
    <svg className="k-mark" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="2" y="2.5" width="20" height="5.5" rx="2.75" />
      <rect x="2" y="9.25" width="14" height="5.5" rx="2.75" />
      <rect x="2" y="16" width="8" height="5.5" rx="2.75" />
    </svg>
  );
}

/** The agent's mark: an ink disc with a four-point spark. */
export function AgentMark({ size = 24, title }: { size?: number; title?: string }) {
  return <span className="k-agent" style={{ width: size, height: size }} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} />;
}

const TONES = 5;
function toneOf(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % TONES) + 1;
}
export function initials(name: string) {
  const words = String(name || "?")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^\d/.test(w));
  return ((words[0]?.[0] || "?") + (words[1]?.[0] || "")).toUpperCase();
}

/** A product's square pastel tile with its initials, as in the landing hero's order list. */
export function ProductTile({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`k-av k-av-${size}`} data-tone={toneOf(name)} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export type BrandName = "paypal" | "zapier" | "neon" | "render" | "pdf" | "json" | "log";
const BRAND_FILE: Record<BrandName, string> = {
  paypal: "paypal.svg",
  zapier: "zapier.svg",
  neon: "neon.svg",
  render: "render.svg",
  pdf: "pdf2.svg",
  json: "json.svg",
  log: "log.svg",
};

/** A real brand or file icon in its own colours on a light tile (files in public/assets/icons). */
export function BrandTile({ name, size = "md", label }: { name: BrandName; size?: "sm" | "md" | "lg"; label?: string }) {
  return (
    <span className={`k-logo k-logo-${size}`} title={label}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/assets/icons/${BRAND_FILE[name]}`} alt={label || ""} width={24} height={24} loading="lazy" />
    </span>
  );
}

/** A small brand icon inline beside text, no tile. */
export function BrandIcon({ name, size = 14 }: { name: BrandName; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="k-brand" src={`/assets/icons/${BRAND_FILE[name]}`} alt="" width={size} height={size} loading="lazy" />;
}

// ---------------------------------------------------------------------------
// Grounds and windows
// ---------------------------------------------------------------------------

/** A lit ground (the landing page's painted panels): something real sits on it. */
export function Lit({
  tone = "sage",
  children,
  className = "",
}: {
  tone?: "sage" | "sky" | "sand" | "land";
  children: ReactNode;
  className?: string;
}) {
  return <div className={`k-lit k-lit--${tone} ${className}`.trim()}>{children}</div>;
}

/** Window chrome: three dots, a breadcrumb with RelayPay's mark, then tools on the right. */
export function Window({
  crumb,
  tools,
  meta,
  children,
  className = "",
}: {
  crumb: string[];
  tools?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`k-win ${className}`.trim()}>
      <div className="k-win__bar">
        <span className="k-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <h2 className="k-win__crumb">
          <StackMark />
          {crumb.map((part, i) =>
            i === crumb.length - 1 ? (
              <b key={i}>{part}</b>
            ) : (
              <span key={i} className="k-win__crumb-part">
                {part} <i aria-hidden="true">/</i>
              </span>
            )
          )}
        </h2>
        <span className="k-spacer" />
        {meta && <span className="k-win__meta">{meta}</span>}
        {tools && <div className="k-win__tools">{tools}</div>}
      </div>
      <div className="k-win__body">{children}</div>
    </section>
  );
}

/** The window's search box, with the "/" key hint. */
export function WindowSearch({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <label className="k-search">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" />
        <path d="m10.5 10.5 3 3" />
      </svg>
      <input aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="k-kbd" aria-hidden="true">
        /
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export function ChatHead({ title, status = "Online", right }: { title: string; status?: string; right?: ReactNode }) {
  return (
    <div className="k-chat-head">
      <AgentMark size={20} />
      <span className="k-title">{title}</span>
      {status && <span className="k-online">{status}</span>}
      <span className="k-spacer" />
      {right}
    </div>
  );
}

export function Chat({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`k-chat ${className}`.trim()}>{children}</div>;
}

/** A message from the person (the café or the buyer). */
export function MsgMe({ children }: { children: ReactNode }) {
  return <div className="k-msg k-msg--me">{children}</div>;
}

/** A line saying what the agent checked, with a tick. */
export function ToolLine({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return <div className={`k-tool ${warn ? "is-warn" : ""}`.trim()}>{children}</div>;
}

/** The agent's answer, with its mark, an optional note and the sources it used. */
export function MsgBot({ children, note, sources }: { children: ReactNode; note?: ReactNode; sources?: ReactNode }) {
  return (
    <div className="k-msg k-msg--bot">
      <AgentMark size={22} />
      <div className="k-msg__col">
        <div className="k-msg__bubble">
          {children}
          {note && <small>{note}</small>}
        </div>
        {sources && <div className="k-srcs">{sources}</div>}
      </div>
    </div>
  );
}

export function Source({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="k-src">
      {icon}
      {children}
    </span>
  );
}

export function ChatActions({ children }: { children: ReactNode }) {
  return <div className="k-acts">{children}</div>;
}

// ---------------------------------------------------------------------------
// Verify with PayPal checklist
// ---------------------------------------------------------------------------

export type CheckItem = { ok: boolean | null; label: ReactNode; detail?: ReactNode };

const Tick = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m4.5 8.2 2.3 2.3 4.7-5" />
  </svg>
);
const Cross = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="m5 5 6 6M11 5l-6 6" />
  </svg>
);

/** The landing page's checklist: a title, "n of N", a progress bar and round ticks. */
export function Checks({ title, items, right }: { title: ReactNode; items: CheckItem[]; right?: ReactNode }) {
  const done = items.filter((i) => i.ok === true).length;
  const bad = items.some((i) => i.ok === false);
  return (
    <div className={`k-checks ${bad ? "is-bad" : ""}`.trim()}>
      <div className="k-checks__head">
        <span className="k-title">{title}</span>
        <span className="k-spacer" />
        {right ?? (
          <span className="k-meta">
            {done} of {items.length}
          </span>
        )}
      </div>
      <div className="k-checks__bar" aria-hidden="true">
        <i style={{ transform: `scaleX(${items.length ? done / items.length : 0})` }} />
      </div>
      <ul className="k-checks__list">
        {items.map((item, i) => (
          <li key={i} className={`k-check ${item.ok === true ? "is-done" : item.ok === false ? "is-bad" : "is-pending"}`}>
            <span className="k-check__box" aria-hidden="true">
              {item.ok === true ? <Tick /> : item.ok === false ? <Cross /> : null}
            </span>
            <span className="k-check__text">
              <span className="k-check__label">{item.label}</span>
              {item.detail && <span className="k-check__detail">{item.detail}</span>}
            </span>
            <span className="sr-only">{item.ok === true ? "passed" : item.ok === false ? "failed" : "not checked"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Code pane
// ---------------------------------------------------------------------------

export function Code({
  file,
  chip,
  start = 1,
  lines,
  hint,
}: {
  file: string;
  chip?: ReactNode;
  start?: number;
  lines: Array<{ code: ReactNode; mark?: boolean }>;
  hint?: ReactNode;
}) {
  return (
    <div className="k-code">
      <div className="k-code__tabs">
        <span className="k-code__tab">
          <i className="k-code__lang">TS</i>
          {file}
        </span>
        <span className="k-spacer" />
        {chip}
      </div>
      <pre>
        <code>
          {lines.map((l, i) => (
            <span key={i} className={`k-ln ${l.mark ? "is-mark" : ""}`.trim()} data-n={start + i}>
              {l.code}
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
      {hint && (
        <div className="k-code__hint">
          <span className="k-dot" />
          <span>{hint}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The approval receipt, as the landing page's document page with its note
// ---------------------------------------------------------------------------

export function ReceiptDoc({
  label,
  seal,
  title,
  children,
  total,
  fingerprint,
  note,
  draft,
}: {
  label: ReactNode;
  seal?: ReactNode;
  title: ReactNode;
  children: ReactNode;
  total?: { label: ReactNode; value: ReactNode };
  fingerprint?: { label: ReactNode; value: ReactNode };
  note?: { kind: ReactNode; msg: ReactNode; where?: ReactNode; tone?: "ok" | "bad" | "neutral" };
  draft?: boolean;
}) {
  return (
    <div className={`k-doc ${draft ? "k-doc--draft" : ""}`.trim()}>
      <article className="k-doc__page">
        <div className="k-doc__label">
          <span>{label}</span>
          {seal}
        </div>
        <div className="k-doc__title">{title}</div>
        <div className="k-doc__body">{children}</div>
        {total && (
          <div className="k-doc__total">
            <span>{total.label}</span>
            <strong>{total.value}</strong>
          </div>
        )}
        {fingerprint && (
          <div className="k-doc__hash">
            <span className="k-doc__hash-label">{fingerprint.label}</span>
            {fingerprint.value}
          </div>
        )}
      </article>
      {note && (
        <aside className={`k-doc__note k-doc__note--${note.tone || "ok"}`} aria-live="polite">
          <div className="k-doc__kind">
            <span className="k-doc__dot" />
            {note.kind}
          </div>
          <div className="k-doc__msg">{note.msg}</div>
          {note.where && <div className="k-doc__where">{note.where}</div>}
        </aside>
      )}
    </div>
  );
}

/** A marked word in the receipt document (the fingerprint, an amount). */
export function DocMark({ children, plain, mono }: { children: ReactNode; plain?: boolean; mono?: boolean }) {
  return <mark className={`k-doc__mark ${plain ? "is-plain" : ""} ${mono ? "is-mono" : ""}`.replace(/\s+/g, " ").trim()}>{children}</mark>;
}

/** Who did something in the ledger: the agent's mark, the café's or supplier's tile, PayPal's logo, or RelayPay's mark. */
export function ActorMark({ actor }: { actor: string }) {
  if (actor === "AGENT") return <AgentMark size={24} title="AI agent" />;
  if (actor === "PAYPAL") return <BrandTile name="paypal" size="sm" label="PayPal" />;
  if (actor === "OWNER")
    return (
      <span className="k-av k-av-sm" data-tone="2" title="Café" aria-hidden="true">
        CA
      </span>
    );
  if (actor === "MERCHANT")
    return (
      <span className="k-av k-av-sm" data-tone="1" title="Supplier" aria-hidden="true">
        SU
      </span>
    );
  return (
    <span className="k-status-glyph k-status-glyph--brand" title="RelayPay" aria-hidden="true">
      <StackMark size={12} />
    </span>
  );
}
