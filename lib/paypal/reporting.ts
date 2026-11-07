import "server-only";
import { paypalFetch } from "./client";

/**
 * Transaction Search (GET /v1/reporting/transactions). PayPal indexes new
 * transactions with a delay of up to a few hours, so this is used only for
 * background reconciliation ("PayPal-side confirmed"), never in the live flow.
 * The app needs the Transaction Search feature enabled in the developer dashboard.
 */
export async function searchTransactions(input: { startDate: string; endDate: string; page?: number }) {
  const params = new URLSearchParams({
    start_date: input.startDate,
    end_date: input.endDate,
    fields: "transaction_info",
    page_size: "100",
    page: String(input.page || 1),
  });
  return paypalFetch<any>(`/v1/reporting/transactions?${params.toString()}`);
}

/** ISO timestamp without milliseconds, the format Transaction Search expects. */
export function reportingDate(d: Date) {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}
