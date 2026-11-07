"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Grid, type ColDef, type GridApi } from "@/components/Grid";
import { Button, Drawer, EmptyState, KeyValues, Pill, RawJson, Segmented } from "@/components/ui";
import { ActorMark, BrandIcon, Window, WindowSearch } from "@/components/kit";
import { IconDownload, IconList } from "@/components/icons";
import { ACTOR_LABEL, dateTime, eventLabel, money, type AnyRecord } from "@/lib/format";
import type { RelayPay } from "@/components/useRelayPay";

type Actor = "ALL" | "AGENT" | "OWNER" | "MERCHANT" | "PAYPAL" | "SYSTEM";
type Mode = "activity" | "webhooks";

export function LedgerView({ app }: { app: RelayPay }) {
  const data = app.data!;
  const [search, setSearch] = useState("");
  const [actor, setActor] = useState<Actor>("ALL");
  const [selected, setSelected] = useState<AnyRecord | null>(null);
  const [mode, setMode] = useState<Mode>("activity");
  const eventsApiRef = useRef<GridApi<AnyRecord> | null>(null);
  const apiRef = useRef<GridApi<AnyRecord> | null>(null);
  const actorRef = useRef<Actor>("ALL");

  const rows = useMemo(
    () => [...data.ledger].reverse().map((e) => ({ ...e, what: eventLabel(e.eventType) })),
    [data.ledger]
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of data.ledger) c[e.actor] = (c[e.actor] || 0) + 1;
    return c;
  }, [data.ledger]);

  // AG Grid external filter: the actor segmented control filters inside the
  // grid, so pagination, sorting, search and CSV export all respect it.
  useEffect(() => {
    actorRef.current = actor;
    apiRef.current?.onFilterChanged();
  }, [actor]);

  const columns = useMemo<ColDef<AnyRecord>[]>(
    () => [
      { field: "createdAt", headerName: "When", width: 150, sort: "desc", valueFormatter: (p) => dateTime(p.value), cellClass: "cell-muted" },
      {
        field: "actor",
        headerName: "Who",
        valueFormatter: (p) => ACTOR_LABEL[p.value] || p.value,
        width: 140,
        cellRenderer: (p: any) => (
          <span className="cell-actor">
            <ActorMark actor={p.data.actor} />
            {ACTOR_LABEL[p.data.actor] || p.data.actor}
          </span>
        ),
      },
      { field: "what", headerName: "What happened", flex: 1.4, minWidth: 240, cellClass: "cell-strong" },
      {
        field: "amount",
        headerName: "Amount",
        width: 110,
        type: "rightAligned",
        valueFormatter: (p) => (p.value ? money(p.value) : "—"),
        cellClass: "cell-num",
      },
      {
        field: "note",
        headerName: "Details",
        flex: 2,
        minWidth: 280,
        wrapText: true,
        autoHeight: true,
        cellClass: "cell-muted cell-wrap",
      },
      { field: "eventType", headerName: "Event code", width: 210, hide: true },
    ],
    []
  );

  const events = useMemo(() => [...data.events].reverse(), [data.events]);
  const eventColumns = useMemo<ColDef<AnyRecord>[]>(
    () => [
      { field: "receivedAt", headerName: "Received", width: 160, sort: "desc", valueFormatter: (p) => dateTime(p.value), cellClass: "cell-muted" },
      { field: "eventType", headerName: "PayPal event", flex: 1.2, minWidth: 220, cellClass: "cell-strong" },
      {
        field: "source",
        headerName: "Signature",
        width: 150,
        cellRenderer: (p: any) =>
          p.value === "REAL" ? (
            <Pill tone="ok" icon={<BrandIcon name="paypal" size={12} />}>
              Verified by PayPal
            </Pill>
          ) : (
            <Pill tone="neutral">Simulator</Pill>
          ),
      },
      { field: "summary", headerName: "Details", flex: 2, minWidth: 260, wrapText: true, autoHeight: true, cellClass: "cell-muted cell-wrap" },
      { field: "resourceId", headerName: "Resource", width: 190, cellRenderer: (p: any) => (p.value ? <code className="cell-code">{p.value}</code> : "—") },
    ],
    []
  );

  return (
    <div className="stack-lg">
      <Window
        crumb={["Ledger", mode === "activity" ? "Activity" : "PayPal webhooks"]}
        tools={
          <>
            <Segmented<Mode>
              label="Ledger view"
              value={mode}
              onChange={setMode}
              options={[
                { value: "activity", label: "Activity", count: data.ledger.length },
                { value: "webhooks", label: "PayPal webhooks", count: data.events.length },
              ]}
            />
            {mode === "activity" && <WindowSearch label="Search the ledger" placeholder="Search the ledger" value={search} onChange={setSearch} />}
            <Button
              size="sm"
              variant="secondary"
              icon={<IconDownload size={14} />}
              disabled={mode === "activity" ? !rows.length : !events.length}
              onClick={() =>
                mode === "activity"
                  ? apiRef.current?.exportDataAsCsv({ fileName: "relaypay-ledger.csv", allColumns: true })
                  : eventsApiRef.current?.exportDataAsCsv({ fileName: "relaypay-paypal-events.csv" })
              }
            >
              Export CSV
            </Button>
          </>
        }
      >
        {mode === "webhooks" ? (
          <>
            <p className="k-win__intro">
              {data.config.webhookConfigured
                ? "Every event PayPal sent, after signature verification. Unsigned events are rejected and never appear here."
                : "PAYPAL_WEBHOOK_ID isn't set, so PayPal events can't be verified yet. Disputes can still be imported from the Disputes page."}
            </p>
            {events.length === 0 ? (
              <div className="k-win__pad">
                <EmptyState icon={<IconList size={22} />} title="No webhook events yet">
                  Register https://&lt;your-app&gt;/api/webhooks/paypal in the PayPal developer dashboard for PAYMENT.CAPTURE.COMPLETED and CUSTOMER.DISPUTE.*.
                </EmptyState>
              </div>
            ) : (
              <div className="k-win__grid">
                <Grid<AnyRecord> rowData={events} columnDefs={eventColumns} getRowId={(r) => r.id} onReady={(api) => (eventsApiRef.current = api)} onRowClicked={setSelected} pageSize={15} />
              </div>
            )}
          </>
        ) : (
          <>
            <div className="k-win__intro ledger-intro">
              <p>An append-only record of every proposal, café approval, charge, verification and dispute decision.</p>
              <Segmented<Actor>
                label="Filter by actor"
                value={actor}
                onChange={setActor}
                options={[
                  { value: "ALL", label: "Everyone", count: data.ledger.length },
                  { value: "AGENT", label: "AI agent", count: counts.AGENT || 0 },
                  { value: "OWNER", label: "Café", count: counts.OWNER || 0 },
                  { value: "MERCHANT", label: "Supplier", count: counts.MERCHANT || 0 },
                  { value: "PAYPAL", label: "PayPal", count: counts.PAYPAL || 0 },
                  { value: "SYSTEM", label: "RelayPay", count: counts.SYSTEM || 0 },
                ]}
              />
            </div>
            {rows.length === 0 ? (
              <div className="k-win__pad">
                <EmptyState icon={<IconList size={22} />} title="The ledger is empty">
                  Ask the agent for a purchase to start the record.
                </EmptyState>
              </div>
            ) : (
              <div className="k-win__grid">
                <Grid<AnyRecord>
                  rowData={rows}
                  columnDefs={columns}
                  quickFilterText={search}
                  getRowId={(r) => r.id}
                  onReady={(api) => (apiRef.current = api)}
                  onRowClicked={setSelected}
                  isExternalFilterPresent={() => actorRef.current !== "ALL"}
                  doesExternalFilterPass={(node) => node.data?.actor === actorRef.current}
                  pageSize={15}
                />
              </div>
            )}
          </>
        )}
      </Window>

      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? (selected.receivedAt ? selected.eventType : eventLabel(selected.eventType)) : ""}
        subtitle={selected ? dateTime(selected.createdAt || selected.receivedAt) : ""}
      >
        {selected && (
          <>
            <KeyValues
              rows={[
                selected.actor && [
                  "Who",
                  <span key="a" className="cell-actor">
                    <ActorMark actor={selected.actor} />
                    {ACTOR_LABEL[selected.actor] || selected.actor}
                  </span>,
                ],
                selected.source && ["Signature", selected.source === "REAL" ? "Verified by PayPal" : "Simulator (unsigned)"],
                selected.summary && ["Details", selected.summary],
                ["Event code", <code key="c">{selected.eventType}</code>],
                selected.amount && ["Amount", money(selected.amount)],
                selected.note && ["Details", selected.note],
                selected.intentId && ["Purchase", <code key="i">{selected.intentId}</code>],
                selected.orderId && ["Order", <code key="o">{selected.orderId}</code>],
                selected.disputeId && ["Dispute", <code key="d">{selected.disputeId}</code>],
              ]}
            />
            <h3 className="drawer-h3">Raw entry</h3>
            <RawJson value={selected} />
          </>
        )}
      </Drawer>
    </div>
  );
}
