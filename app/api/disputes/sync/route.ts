import { NextResponse } from "next/server";
import { loadDB, mutate, HttpError } from "@/lib/store";
import { getDispute, listDisputes } from "@/lib/paypal/disputes";
import { CLOSED_STATUSES, draftAndSave, findOrderForDispute } from "@/lib/disputeService";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { route } from "@/lib/http";

const MAX_NEW_PER_SYNC = 3;

/**
 * Poll PayPal for disputes, so the dispute agent works even when webhooks are
 * not configured (local development) or a webhook was missed.
 * New disputes that point at a RelayPay capture are imported and drafted.
 * Known disputes get their PayPal status refreshed.
 */
export const POST = route(async (req: Request) => {
  const ip = clientIp(req);
  await mutate((db) => {
    const limit = checkRateLimit(db, "paypal", ip);
    if (!limit.ok) throw new HttpError(429, limit.reason);
  });

  const list = await listDisputes({ pageSize: 20 });
  const items: any[] = Array.isArray(list?.items) ? list.items : [];
  const snapshot = await loadDB();
  const known = new Map(snapshot.disputes.filter((d) => !d.simulator).map((d) => [d.paypalDisputeId, d.id]));

  // Refresh statuses of disputes we already track.
  const updates = items.filter((i) => known.has(i.dispute_id));
  if (updates.length) {
    await mutate((db) => {
      for (const item of updates) {
        const d = db.disputes.find((x) => x.paypalDisputeId === item.dispute_id && !x.simulator);
        if (d && !d.submitted && !d.resolution && item.status) d.status = String(item.status);
      }
    });
  }

  const imported: string[] = [];
  const unrelated: string[] = [];
  const candidates = items.filter((i) => i.dispute_id && !known.has(i.dispute_id) && !CLOSED_STATUSES.has(String(i.status || "").toUpperCase()));
  for (const item of candidates) {
    if (imported.length >= MAX_NEW_PER_SYNC) break;
    const full = await getDispute(item.dispute_id).catch(() => null);
    if (!full) continue;
    if (!findOrderForDispute(snapshot, full).order) {
      unrelated.push(item.dispute_id);
      continue;
    }
    await draftAndSave({ paypalDisputeId: full.dispute_id || item.dispute_id, paypalDispute: full, source: "SYNC" });
    imported.push(full.dispute_id || item.dispute_id);
  }

  return NextResponse.json({
    found: items.length,
    imported,
    refreshed: updates.length,
    unrelated: unrelated.length,
    more: candidates.length > imported.length + unrelated.length,
  });
});
