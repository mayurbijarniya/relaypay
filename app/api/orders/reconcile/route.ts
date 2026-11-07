import { NextResponse } from "next/server";
import { addLedger, loadDB, mutate, HttpError } from "@/lib/store";
import { searchTransactions, reportingDate } from "@/lib/paypal/reporting";
import { PayPalApiError } from "@/lib/paypal/client";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { route } from "@/lib/http";

/**
 * Background reconciliation with PayPal Transaction Search: marks each
 * RelayPay capture that appears in PayPal's reporting ledger as
 * "PayPal-side confirmed". Returns only counts, never raw merchant data.
 *
 * PayPal indexes transactions with a delay (often up to a few hours), so a
 * fresh capture showing as "not yet indexed" is normal.
 */
export const POST = route(async (req: Request) => {
  const ip = clientIp(req);
  await mutate((db) => {
    const limit = checkRateLimit(db, "paypal", ip);
    if (!limit.ok) throw new HttpError(429, limit.reason);
  });

  const snapshot = await loadDB();
  const captured = snapshot.orders.filter((o) => o.status === "COMPLETED" && o.captureId);
  if (!captured.length) return NextResponse.json({ checked: 0, confirmed: 0, pending: 0 });

  const earliest = Math.min(...captured.map((o) => Date.parse(o.capturedAt || o.createdAt) || Date.now()));
  const end = new Date();
  // Transaction Search accepts at most 31 days per request.
  const start = new Date(Math.max(earliest - 86_400_000, end.getTime() - 30 * 86_400_000));

  const found = new Set<string>();
  try {
    for (let page = 1; page <= 5; page++) {
      const data = await searchTransactions({ startDate: reportingDate(start), endDate: reportingDate(end), page });
      for (const row of Array.isArray(data?.transaction_details) ? data.transaction_details : []) {
        const txId = row?.transaction_info?.transaction_id;
        if (txId) found.add(String(txId));
      }
      if (!data?.total_pages || page >= Number(data.total_pages)) break;
    }
  } catch (e) {
    if (e instanceof PayPalApiError && (e.status === 403 || e.status === 401)) {
      throw new HttpError(
        403,
        "PayPal refused Transaction Search. Enable “Transaction search” for this app in the PayPal developer dashboard, then try again."
      );
    }
    throw e;
  }

  const result = await mutate((db) => {
    let confirmed = 0;
    let pending = 0;
    const at = new Date().toISOString();
    for (const o of db.orders) {
      if (o.status !== "COMPLETED" || !o.captureId) continue;
      o.reconciledAt = at;
      if (found.has(o.captureId)) {
        o.paypalConfirmedAt = o.paypalConfirmedAt || at;
        confirmed++;
      } else if (!o.paypalConfirmedAt) {
        pending++;
      } else {
        confirmed++;
      }
    }
    addLedger(db, {
      actor: "SYSTEM",
      eventType: "RECONCILED",
      note: `${confirmed} confirmed in PayPal's reporting ledger, ${pending} not indexed yet`,
    });
    return { checked: confirmed + pending, confirmed, pending };
  });

  return NextResponse.json(result);
});
