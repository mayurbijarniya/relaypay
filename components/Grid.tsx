"use client";

import dynamic from "next/dynamic";
import type { ColDef, GridApi, RowClickedEvent } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
// The full quartz theme ships the icon font for sort, filter and paging icons.
import "ag-grid-community/styles/ag-theme-quartz.css";
import { Spinner } from "@/components/ui";

const AgGridReact: any = dynamic(() => import("ag-grid-react").then((m) => m.AgGridReact), {
  ssr: false,
  loading: () => (
    <div className="grid-loading">
      <Spinner /> Loading table…
    </div>
  ),
});

export type { ColDef, GridApi };

/**
 * AG Grid (Community) wrapper used for the Receipts and Ledger tables.
 * The grid API is handed back through onReady so the page can call
 * exportDataAsCsv and other grid methods.
 */
export function Grid<T = any>({
  rowData,
  columnDefs,
  quickFilterText,
  onRowClicked,
  onReady,
  height,
  pageSize = 15,
  getRowId,
  context,
  isExternalFilterPresent,
  doesExternalFilterPass,
}: {
  rowData: T[];
  columnDefs: ColDef<T>[];
  quickFilterText?: string;
  onRowClicked?: (row: T) => void;
  onReady?: (api: GridApi<T>) => void;
  /** Fixed height in px. When omitted the grid grows with its rows (one page at a time). */
  height?: number;
  pageSize?: number;
  getRowId?: (row: T) => string;
  context?: any;
  isExternalFilterPresent?: () => boolean;
  doesExternalFilterPass?: (node: any) => boolean;
}) {
  return (
    <div className="ag-theme-quartz rp-grid" style={height ? { height } : undefined}>
      <AgGridReact
        domLayout={height ? "normal" : "autoHeight"}
        rowData={rowData}
        columnDefs={columnDefs}
        context={context}
        quickFilterText={quickFilterText}
        defaultColDef={{ sortable: true, filter: true, resizable: true, suppressHeaderMenuButton: false }}
        getRowId={getRowId ? (p: any) => getRowId(p.data) : undefined}
        onGridReady={(e: any) => onReady?.(e.api)}
        onRowClicked={(e: RowClickedEvent<T>) => e.data && onRowClicked?.(e.data)}
        rowClass={onRowClicked ? "rp-row-clickable" : undefined}
        rowHeight={52}
        headerHeight={42}
        animateRows
        pagination
        paginationPageSize={pageSize}
        paginationPageSizeSelector={[10, 15, 25, 50]}
        isExternalFilterPresent={isExternalFilterPresent}
        doesExternalFilterPass={doesExternalFilterPass}
        overlayNoRowsTemplate='<span class="grid-empty">No rows match this filter.</span>'
      />
    </div>
  );
}
