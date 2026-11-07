import { NextResponse, after } from "next/server";
import { addLedger, mutate, uid } from "@/lib/store";
import { getAccessToken, paypalBaseUrl } from "@/lib/paypal/client";
import { getDispute } from "@/lib/paypal/disputes";
import { draftAndSave, SAMPLE_ID } from "@/lib/disputeService";
import { centsFromUsd } from "@/lib/policy";
import { notifyOwner } from "@/lib/notify";
import { reasonLabel } from "@/lib/format";

type Verification = { ok: boolean; source: "REAL" | "SIMULATOR"; reason?: string };

/**
 * Real events must pass PayPal's signature verification against
 * PAYPAL_WEBHOOK_ID. Simulator events (unsigned) are accepted only when
 * ALLOW_SIMULATOR=true, and they never change orders or real disputes.
 */
async function verifyWebhook(req: Request, event: any, webhookId: string): Promise<Verification> {
  if (req.headers.get("x-simulator") === "true") {
    return process.env.ALLOW_SIMULATOR === "true"
      ? { ok: true, source: "SIMULATOR" }
      : { ok: false, source: "SIMULATOR", reason: "simulator events are disabled (ALLOW_SIMULATOR is not true)" };
  }
  if (!webhookId) return { ok: false, source: "REAL", reason: "PAYPAL_WEBHOOK_ID is not configured" };
  try {
    const token = await getAccessToken();
    const res = await fetch(`${paypalBaseUrl}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        auth_algo: req.headers.get("paypal-auth-algo"),
        cert_url: req.headers.get("paypal-cert-url"),
        transmission_id: req.headers.get("paypal-transmission-id"),
        transmission_sig: req.headers.get("paypal-transmission-sig"),
        transmission_time: req.headers.get("paypal-transmission-time"),
        webhook_id: webhookId,
        webhook_event: event,
      }),
    });
    const data = await res.json().catch(() => ({}));
    return data.verification_status === "SUCCESS" ? { ok: true, source: "REAL" } : { ok: false, source: "REAL", reason: "PayPal rejected the signature" };
  } catch (e: any) {
    return { ok: false, source: "REAL", reason: e?.message || "verification request failed" };
  }
}

function summarize(event: any) {
  const r = event?.resource || {};
  if (String(event?.event_type || "").startsWith("PAYMENT.CAPTURE")) return `Capture ${r.id || "?"} · ${r.amount?.value || "?"} ${r.amount?.currency_code || ""} · ${r.status || ""}`;
  if (String(event?.event_type || "").startsWith("CUSTOMER.DISPUTE")) return `Dispute ${r.dispute_id || r.id || "?"} · ${r.reason || ""} · ${r.status || ""}`;
  return event?.summary || "";
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    if (rawBody.length > 1_000_000) return NextResponse.json({ error: "webhook body too large" }, { status: 413 });
    let event: any;
    try {
      event = JSON.parse(rawBody || "{}");
    } catch {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }

    const verification = await verifyWebhook(req, event, process.env.PAYPAL_WEBHOOK_ID || "");
    if (!verification.ok) {
      return NextResponse.json({ error: "webhook rejected", reason: verification.reason }, { status: verification.source === "SIMULATOR" ? 403 : 400 });
    }
    const simulator = verification.source === "SIMULATOR";
    const type = String(event.event_type || "UNKNOWN");

    const outcome = await mutate((db) => {
      if (event.id && db.events.some((e) => e.providerEventId === event.id)) return { duplicate: true as const };

      const resource = event.resource || {};
      db.events.push({
        id: uid(),
        providerEventId: event.id || uid(),
        eventType: type,
        source: verification.source,
        resourceId: resource.id || resource.dispute_id,
        summary: summarize(event),
        // Keep the stored payload bounded.
        rawPayload: rawBody.length > 60_000 ? { truncated: true, event_type: type, id: event.id } : event,
        receivedAt: new Date().toISOString(),
      });

      if (simulator) {
        addLedger(db, { actor: "SYSTEM", eventType: "SIMULATOR_EVENT_IGNORED", note: `Simulator ${type} recorded; no order or real dispute changed.` });
        return { duplicate: false as const, sampleDispute: type === "CUSTOMER.DISPUTE.CREATED" ? resource : null };
      }

      if (type === "PAYMENT.CAPTURE.COMPLETED") {
        const orderId = resource.supplementary_data?.related_ids?.order_id;
        const captureId = resource.id;
        let order = db.orders.find((o) => (orderId && o.paypalOrderId === orderId) || (captureId && o.captureId === captureId));
        // The receipt hash in custom_id is a unique join key back to the receipt.
        if (!order && resource.custom_id) {
          const intent = db.intents.find((i) => i.receiptHash === resource.custom_id);
          if (intent) order = db.orders.find((o) => o.intentId === intent.id);
        }
        if (!order) {
          addLedger(db, { actor: "PAYPAL", eventType: "CAPTURE_ORPHAN", note: `Capture ${captureId} doesn't match a RelayPay payment` });
        } else {
          const ok =
            (!resource.amount?.value || centsFromUsd(resource.amount.value) === centsFromUsd(order.amount)) &&
            (!resource.amount?.currency_code || resource.amount.currency_code === (order.currency || "USD")) &&
            (!resource.custom_id || resource.custom_id === order.customId) &&
            (!order.captureId || !captureId || order.captureId === captureId);
          if (!ok) {
            addLedger(db, {
              actor: "PAYPAL",
              eventType: "CAPTURE_MISMATCH",
              intentId: order.intentId,
              orderId: order.id,
              amount: resource.amount?.value,
              note: `Capture ${captureId} didn't match the receipt (amount, currency, custom_id or capture ID). Not marked paid.`,
            });
          } else {
            order.captureId = captureId || order.captureId;
            order.status = "COMPLETED";
            order.capturedAt = order.capturedAt || new Date().toISOString();
            const intent = db.intents.find((i) => i.id === order!.intentId);
            if (intent && intent.status === "APPROVED") intent.status = "CAPTURED";
            if (intent && !order.stockApplied && intent.product in db.inventory) {
              db.inventory[intent.product] = (db.inventory[intent.product] || 0) + Number(intent.quantity || 0);
              order.stockApplied = true;
            }
            addLedger(db, {
              actor: "PAYPAL",
              eventType: "CAPTURE_COMPLETED",
              intentId: order.intentId,
              orderId: order.id,
              amount: order.amount,
              note: `Capture ${captureId} confirmed by a signed webhook`,
            });
          }
        }
      }

      if (type === "CUSTOMER.DISPUTE.UPDATED" || type === "CUSTOMER.DISPUTE.RESOLVED") {
        const disputeId = resource.dispute_id || resource.id;
        const record = db.disputes.find((d) => d.paypalDisputeId === disputeId && !d.simulator);
        if (record) {
          record.status = resource.status || record.status;
          if (type === "CUSTOMER.DISPUTE.RESOLVED") {
            record.resolution = resource.dispute_outcome?.outcome_code === "RESOLVED_BUYER_FAVOUR" ? "ACCEPTED" : "CONTESTED";
          }
          record.updatedAt = new Date().toISOString();
          addLedger(db, { actor: "PAYPAL", eventType: type, orderId: record.orderId, disputeId: record.id, note: `Dispute ${disputeId} is now ${record.status}` });
        }
      }

      if (type === "CUSTOMER.DISPUTE.CREATED") {
        const disputeId = resource.dispute_id || resource.id;
        if (!disputeId) {
          addLedger(db, { actor: "PAYPAL", eventType: "DISPUTE_ORPHAN", note: "CUSTOMER.DISPUTE.CREATED arrived without a dispute ID" });
          return { duplicate: false as const };
        }
        if (!db.disputes.some((d) => d.paypalDisputeId === disputeId && !d.simulator)) {
          return { duplicate: false as const, newDisputeId: String(disputeId), resource };
        }
      }
      return { duplicate: false as const };
    });

    if (outcome.duplicate) return NextResponse.json({ duplicate: true, source: verification.source });

    // The dispute agent can take a while; reply to PayPal first so it doesn't
    // retry, then draft in the background.
    if ("newDisputeId" in outcome && outcome.newDisputeId) {
      const disputeId = outcome.newDisputeId;
      const resource = outcome.resource;
      after(async () => {
        try {
          const full = await getDispute(disputeId).catch(() => ({ ...resource, dispute_id: disputeId }));
          const record = await draftAndSave({ paypalDisputeId: disputeId, paypalDispute: full, source: "WEBHOOK" });
          await notifyOwner("dispute_opened", {
            title: reasonLabel(record.reason),
            message: `New PayPal dispute ${disputeId}. The agent recommends ${record.agentRecommendation === "CONTEST" ? "contesting" : "a refund"}. Review it before anything is sent.`,
            amount: record.amount,
            view: "disputes",
            reference: disputeId,
          });
        } catch (e: any) {
          await mutate((db) => addLedger(db, { actor: "SYSTEM", eventType: "DISPUTE_DRAFT_FAILED", note: `Dispute ${disputeId}: ${e?.message || "draft failed"}` })).catch(
            () => undefined
          );
        }
      });
    }
    if ("sampleDispute" in outcome && outcome.sampleDispute) {
      const sample = outcome.sampleDispute;
      after(async () => {
        try {
          await draftAndSave({
            paypalDisputeId: SAMPLE_ID,
            paypalDispute: null,
            hint: { captureId: sample?.disputed_transactions?.[0]?.seller_transaction_id },
            sampleReason: sample?.reason,
            source: "SAMPLE",
          });
        } catch (e: any) {
          await mutate((db) => addLedger(db, { actor: "SYSTEM", eventType: "SIMULATOR_DRAFT_FAILED", note: e?.message || "sample draft failed" })).catch(
            () => undefined
          );
        }
      });
    }

    return NextResponse.json({ received: true, source: verification.source });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "webhook failed" }, { status: 500 });
  }
}
