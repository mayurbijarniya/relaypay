"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { IconAlert, IconCheck, IconCopy, IconInfo, IconMoon, IconSparkle, IconSun, IconX } from "@/components/icons";
import {
  TOOL_LABEL,
  dateTime,
  toolInputSummary,
  toolOutputSummary,
  type AnyRecord,
  type Tone,
} from "@/lib/format";

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "success" | "danger";
  size?: "sm" | "md";
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
  href?: string;
  external?: boolean;
  className?: string;
};

export function Button({
  children,
  onClick,
  variant = "secondary",
  size = "md",
  icon,
  loading,
  disabled,
  title,
  type = "button",
  href,
  external,
  className = "",
}: ButtonProps) {
  const cls = `btn btn-${variant} btn-${size} ${className}`.trim();
  const content = (
    <>
      {loading ? <Spinner /> : icon}
      <span>{children}</span>
    </>
  );
  if (href) {
    return (
      <a className={cls} href={href} title={title} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
        {content}
      </a>
    );
  }
  return (
    <button
      type={type}
      className={cls}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      title={title}
    >
      {content}
    </button>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Theme toggle (dark is the default; the choice is remembered per browser)
// ---------------------------------------------------------------------------

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("relaypay-theme", next);
        } catch {
          // Private mode can block storage; the toggle still works for this visit.
        }
        setTheme(next);
      }}
    >
      {theme === "dark" ? <IconSun size={15} /> : <IconMoon size={15} />}
      <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Pills, dots, cards
// ---------------------------------------------------------------------------

export function Pill({ tone = "neutral", children, icon }: { tone?: Tone; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={`pill pill-${tone}`}>
      {icon}
      {children}
    </span>
  );
}

export function Dot({ tone = "neutral" }: { tone?: Tone }) {
  return <span className={`dot dot-${tone}`} aria-hidden="true" />;
}

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <section className={`card ${padded ? "card-padded" : ""} ${className}`.trim()}>{children}</section>;
}

export function CardHeader({
  title,
  subtitle,
  actions,
  icon,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <header className="card-header">
      <div className="card-header-text">
        <h2 className="card-title">
          {icon && <span className="card-title-icon">{icon}</span>}
          {title}
        </h2>
        {subtitle && <p className="card-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="card-header-actions">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
}) {
  const icon = tone === "bad" || tone === "warn" ? <IconAlert size={16} /> : tone === "ok" ? <IconCheck size={16} /> : <IconInfo size={16} />;
  return (
    <div className={`callout callout-${tone}`} role={tone === "bad" ? "alert" : undefined}>
      <span className="callout-icon">{icon}</span>
      <div>
        {title && <strong className="callout-title">{title}</strong>}
        {children && <div className="callout-body">{children}</div>}
      </div>
    </div>
  );
}

export function KeyValues({ rows }: { rows: Array<[ReactNode, ReactNode] | false | null | undefined> }) {
  return (
    <dl className="kv">
      {rows.filter(Boolean).map((row, i) => {
        const [k, v] = row as [ReactNode, ReactNode];
        return (
          <div className="kv-row" key={i}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        );
      })}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Copyable monospace value
// ---------------------------------------------------------------------------

export function CopyValue({ value, display, label = "Copy" }: { value?: string; display?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="muted">—</span>;
  return (
    <span className="copy-value">
      <code title={value}>{display ?? value}</code>
      <button
        type="button"
        className="icon-btn"
        aria-label={`${label} ${value}`}
        title={copied ? "Copied" : label}
        onClick={async (e) => {
          e.stopPropagation();
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          } catch {
            // Clipboard can be blocked; the value is still selectable.
          }
        }}
      >
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Segmented control
// ---------------------------------------------------------------------------

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; count?: number }>;
  label: string;
}) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={value === o.value ? "active" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {typeof o.count === "number" && <span className="segmented-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

export type Toast = { id: number; tone: Tone; title: string; body?: string };

export function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === "bad" ? "alert" : "status"}>
          <span className="toast-icon">
            {t.tone === "bad" || t.tone === "warn" ? <IconAlert size={16} /> : <IconCheck size={16} />}
          </span>
          <div className="toast-text">
            <strong>{t.title}</strong>
            {t.body && <p>{t.body}</p>}
          </div>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>
            <IconX size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm dialog (replaces window.confirm for irreversible actions)
// ---------------------------------------------------------------------------

export type ConfirmRequest = {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger" | "success";
  /** When set, the person must tick this box before confirming. */
  acknowledge?: string;
  onConfirm: () => void;
};

export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
  const [ack, setAck] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    setAck(false);
    if (request) cancelRef.current?.focus();
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, onClose]);

  if (!request) return null;
  const blocked = !!request.acknowledge && !ack;

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="dialog-title">
          {request.title}
        </h2>
        <div className="dialog-body">{request.body}</div>
        {request.acknowledge && (
          <label className="dialog-ack">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>{request.acknowledge}</span>
          </label>
        )}
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="btn btn-ghost btn-md" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn btn-${request.tone || "primary"} btn-md`}
            disabled={blocked}
            onClick={() => {
              onClose();
              request.onConfirm();
            }}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

export function Drawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="overlay overlay-drawer" onMouseDown={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="drawer-header">
          <div>
            <h2 id={titleId} className="drawer-title">
              {title}
            </h2>
            {subtitle && <p className="drawer-subtitle">{subtitle}</p>}
          </div>
          <button ref={closeRef} type="button" className="icon-btn icon-btn-lg" aria-label="Close" onClick={onClose}>
            <IconX size={18} />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <footer className="drawer-footer">{footer}</footer>}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Disclosure
// ---------------------------------------------------------------------------

export function Disclosure({ summary, children, defaultOpen }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="disclosure" open={defaultOpen}>
      <summary>{summary}</summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}

export function RawJson({ value }: { value: unknown }) {
  return <pre className="raw-json">{JSON.stringify(value, null, 2)}</pre>;
}

// ---------------------------------------------------------------------------
// Agent trace
// ---------------------------------------------------------------------------

export function AgentTrace({ calls, compact }: { calls?: AnyRecord[]; compact?: boolean }) {
  if (!Array.isArray(calls) || calls.length === 0) {
    return <p className="muted small">No tool calls were recorded for this run.</p>;
  }
  return (
    <ol className={`trace ${compact ? "trace-compact" : ""}`}>
      {calls.map((call, i) => {
        const input = toolInputSummary(call);
        const output = toolOutputSummary(call);
        const failed = !!call?.output?.error;
        return (
          <li key={`${call.tool}-${i}`} className={failed ? "trace-failed" : ""}>
            <span className="trace-marker" aria-hidden="true">
              {failed ? <IconX size={12} /> : <IconCheck size={12} />}
            </span>
            <div className="trace-content">
              <div className="trace-line">
                <span className="trace-tool">{TOOL_LABEL[call.tool] || call.tool}</span>
                {input && <span className="trace-input">{input}</span>}
                <span className={`trace-source trace-source-${String(call.source || "").toLowerCase()}`}>
                  {call.source === "FALLBACK" ? "fallback" : (
                    <>
                      <IconSparkle size={11} /> model
                    </>
                  )}
                </span>
              </div>
              {output && <div className="trace-output">{output}</div>}
              {!compact && (
                <div className="trace-meta">
                  <code>{call.tool}</code>
                  <span>{dateTime(call.at)}</span>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
