"use client";

import { useMemo, useRef, useState } from "react";
import { Grid, type ColDef, type GridApi } from "@/components/Grid";
import { Button, EmptyState, Pill } from "@/components/ui";
import { ProductTile, Window, WindowSearch } from "@/components/kit";
import { IconDownload, IconReceipt, IconRefresh, IconShield } from "@/components/icons";
import { dateTime, money, shortId, type AnyRecord } from "@/lib/format";
import type { RelayPay } from "@/components/useRelayPay";

type Payment = "NOT_CHARGED" | "CAPTURED" | "PENDING";

type Row = {
  id: string;
  intentId: string;
  orderId?: string;
  sealedAt: string;
  product: string;
  quantity: number;
  amount: string;
  approvedBy?: string;
  payment: Payment;
  paypalStatus?: string;
  paypalOrderId?: string;
  captureId?: string;
  fingerprint: string;
  verified: boolean;
  paypalConfirmedAt?: string;
  reconciledAt?: string;
};

/**
 * Every receipt the café has sealed, whether or not it has been charged yet.
 * A receipt exists from the moment of approval; charging adds the PayPal order
 * and capture, and verifying compares PayPal's custom_id with the fingerprint.
 */
export function ReceiptsView({ app, openReceipt }: { app: RelayPay; openReceipt: (intent: AnyRecord) => void }) {
  const data = app.data!;
  const [search, setSearch] = useState("");
  const apiRef = useRef<GridApi<Row> | null>(null);
  const vaultReady = data.vault.active;

  const rows: Row[] = useMemo(
    () =>
      [...data.intents]
        .filter((i) => i.receiptHash)
        .reverse()
        .map((intent) => {
          const order = app.ordersByIntent[intent.id];
          const payment: Payment = !order ? "NOT_CHARGED" : order.status === "COMPLETED" ? "CAPTURED" : "PENDING";
          return {
            id: intent.id,
            intentId: intent.id,
            orderId: order?.id,
            sealedAt: intent.approvedAt || intent.createdAt,
            product: intent.product || "—",
            quantity: intent.quantity || 1,
            amount: intent.amount,
            approvedBy: intent.approvedBy,
            payment,
            paypalStatus: order?.status,
            paypalOrderId: order?.paypalOrderId,
            captureId: order?.captureId,
            fingerprint: intent.receiptHash,
            verified: app.isVerified(order),
            paypalConfirmedAt: order?.paypalConfirmedAt,
            reconciledAt: order?.reconciledAt,
          };
        }),
    [data.intents, app]
  );

  const columns = useMemo<ColDef<Row>[]>(
    () => [
      { field: "sealedAt", headerName: "Sealed", width: 140, sort: "desc", valueFormatter: (p) => dateTime(p.value), cellClass: "cell-muted" },
      {
        field: "product",
        headerName: "Item",
        flex: 1.6,
        minWidth: 220,
        cellRenderer: (p: any) => (
          <span className="cell-product">
            <ProductTile name={p.value} size="sm" />
            <span className="cell-item">
              <strong>{p.value}</strong>
              <small>
                {p.data.quantity} × · approved by {p.data.approvedBy || "—"}
              </small>
            </span>
          </span>
        ),
      },
      {
        field: "amount",
        headerName: "Amount",
        width: 110,
        type: "rightAligned",
        valueFormatter: (p) => money(p.value),
        comparator: (a, b) => Number(a) - Number(b),
        cellClass: "cell-num",
      },
      {
        field: "payment",
        headerName: "PayPal payment",
        width: 150,
        valueFormatter: (p) => (p.value === "CAPTURED" ? "Captured" : p.value === "PENDING" ? "Pending" : "Not charged yet"),
        cellRenderer: (p: any) =>
          p.value === "CAPTURED" ? (
            <Pill tone="ok">Captured</Pill>
          ) : p.value === "PENDING" ? (
            <Pill tone="warn">{String(p.data.paypalStatus || "Pending").toLowerCase()}</Pill>
          ) : (
            <Pill tone="neutral">Not charged yet</Pill>
          ),
      },
      {
        field: "verified",
        headerName: "PayPal check",
        width: 140,
        valueFormatter: (p) => (p.value ? "Verified" : "Not checked"),
        cellRenderer: (p: any) =>
          p.value ? (
            <Pill tone="ok" icon={<IconShield size={12} />}>
              Verified
            </Pill>
          ) : (
            <span className="cell-muted">{p.data.payment === "CAPTURED" ? "Not checked yet" : "—"}</span>
          ),
      },
      {
        field: "fingerprint",
        headerName: "Fingerprint (custom_id)",
        headerTooltip: "SHA-256 of the sealed receipt. Sent to PayPal as custom_id when charged.",
        flex: 1,
        minWidth: 180,
        cellRenderer: (p: any) => <code className="cell-code">{shortId(p.value, 12, 6)}</code>,
      },
      {
        field: "paypalConfirmedAt",
        headerName: "PayPal ledger",
        headerTooltip: "Found in PayPal Transaction Search (reconciliation)",
        width: 140,
        valueFormatter: (p) => (p.value ? "Confirmed" : ""),
        cellRenderer: (p: any) =>
          p.value ? (
            <Pill tone="ok">Confirmed</Pill>
          ) : (
            <span className="cell-muted">{p.data.payment !== "CAPTURED" ? "—" : p.data.reconciledAt ? "Not indexed yet" : "Not reconciled"}</span>
          ),
      },
      { field: "captureId", headerName: "PayPal capture", width: 160, hide: true },
      { field: "paypalOrderId", headerName: "PayPal order", width: 170, hide: true },
      {
        headerName: "",
        colId: "actions",
        width: 120,
        sortable: false,
        filter: false,
        resizable: false,
        pinned: "right",
        cellRenderer: (p: any) => {
          const row: Row = p.data;
          if (row.payment === "NOT_CHARGED") {
            const intent = app.intentsById[row.intentId];
            const busy = !!app.busy[`capture:${row.intentId}`];
            return (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                title={vaultReady ? "Charge with the café's saved PayPal" : "Connect PayPal Vault in Settings first"}
                disabled={!vaultReady || busy || !intent}
                onClick={(e) => {
                  e.stopPropagation();
                  if (intent) void app.actions.capture(intent);
                }}
              >
                {busy ? "Charging…" : "Charge"}
              </button>
            );
          }
          const order = row.orderId ? data.orders.find((o) => o.id === row.orderId) : undefined;
          const busy = !!(row.orderId && app.busy[`verify:${row.orderId}`]);
          return (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={row.payment !== "CAPTURED" || busy || !order}
              onClick={(e) => {
                e.stopPropagation();
                if (order) void app.actions.verify(order);
              }}
            >
              {busy ? "Checking…" : row.verified ? "Verify again" : "Verify"}
            </button>
          );
        },
      },
    ],
    [app, data.orders, vaultReady]
  );

  const charged = rows.filter((r) => r.payment === "CAPTURED");
  const waiting = rows.filter((r) => r.payment === "NOT_CHARGED");
  const verifiedCount = charged.filter((r) => r.verified).length;
  const total = charged.reduce((sum, r) => sum + Number(r.amount || 0), 0);

  return (
    <div className="stack-lg">
      <div className="stat-grid stat-grid-3">
        <div className="stat">
          <span className="stat-label">Sealed receipts</span>
          <strong className="stat-value">{rows.length}</strong>
          <span className="stat-detail">
            {charged.length} charged · {waiting.length} waiting to be charged
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Charged through PayPal</span>
          <strong className="stat-value">{money(total)}</strong>
          <span className="stat-detail">
            {charged.length} captured payment{charged.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className={`stat ${charged.length && verifiedCount === charged.length ? "stat-ok" : ""}`}>
          <span className="stat-label">Verified with PayPal</span>
          <strong className="stat-value">
            {verifiedCount} / {charged.length}
          </strong>
          <span className="stat-detail">PayPal&apos;s custom_id matches the fingerprint</span>
        </div>
      </div>

      {waiting.length > 0 && !vaultReady && (
        <p className="k-banner">
          {waiting.length} sealed receipt{waiting.length === 1 ? " is" : "s are"} waiting to be charged. <a href="#settings">Connect PayPal Vault in Settings</a> to charge it with the café&apos;s saved PayPal.
        </p>
      )}

      <Window
        crumb={["Receipts", search ? `Search: ${search}` : "All"]}
        meta={`${rows.length} receipt${rows.length === 1 ? "" : "s"}`}
        tools={
          <>
            <WindowSearch label="Search receipts" placeholder="Search item, fingerprint or PayPal ID" value={search} onChange={setSearch} />
            <Button size="sm" variant="secondary" icon={<IconRefresh size={14} />} loading={app.busy.reconcile} disabled={!charged.length} onClick={() => void app.actions.reconcile()}>
              Reconcile with PayPal
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<IconDownload size={14} />}
              disabled={!rows.length}
              onClick={() =>
                apiRef.current?.exportDataAsCsv({
                  fileName: "relaypay-receipts.csv",
                  columnKeys: ["sealedAt", "product", "amount", "payment", "verified", "paypalConfirmedAt", "fingerprint", "captureId", "paypalOrderId"],
                })
              }
            >
              Export CSV
            </Button>
          </>
        }
      >
        <p className="k-win__intro">A receipt is sealed the moment the café approves. Charging it sends the fingerprint to PayPal as custom_id. Click a row to open it.</p>
        {rows.length === 0 ? (
          <div className="k-win__pad">
            <EmptyState icon={<IconReceipt size={22} />} title="No sealed receipts yet">
              When the café approves a proposal on Purchases, its receipt appears here straight away.
            </EmptyState>
          </div>
        ) : (
          <div className="k-win__grid">
            <Grid<Row>
              rowData={rows}
              columnDefs={columns}
              quickFilterText={search}
              getRowId={(r) => r.id}
              onReady={(api) => (apiRef.current = api)}
              onRowClicked={(row) => {
                const intent = app.intentsById[row.intentId];
                if (intent) openReceipt(intent);
              }}
            />
          </div>
        )}
      </Window>
    </div>
  );
}
