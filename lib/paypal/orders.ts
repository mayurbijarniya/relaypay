import "server-only";
import { paypalFetch } from "./client";

export type CreateOrderResponse = {
  id: string;
  status: string;
  intent: string;
  purchase_units?: Array<{
    payments?: { captures?: Array<{ id: string; status: string }> };
    custom_id?: string;
  }>;
  links: { href: string; rel: string; method: string }[];
};

export async function createCaptureOrderWithVault(input: {
  vaultId: string;
  amount: string;
  currency: string;
  receiptHash: string;
  requestId: string;
}) {
  return paypalFetch<CreateOrderResponse>("/v2/checkout/orders", {
    method: "POST",
    headers: { "PayPal-Request-Id": input.requestId } as any,
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: { currency_code: input.currency, value: input.amount },
          custom_id: input.receiptHash,
          description: "RelayPay owner-approved agent purchase",
        },
      ],
      payment_source: {
        paypal: { vault_id: input.vaultId },
      },
    }),
  });
}

/**
 * Orders created with a vault_id occasionally come back APPROVED rather than
 * COMPLETED. In that case the capture must be requested explicitly; otherwise
 * the app would label an uncaptured order as captured.
 */
export async function captureOrder(paypalOrderId: string) {
  return paypalFetch<any>(`/v2/checkout/orders/${paypalOrderId}/capture`, {
    method: "POST",
    headers: { "PayPal-Request-Id": `relaypay-capture-${paypalOrderId}` } as any,
    body: JSON.stringify({}),
  });
}

export async function getOrder(paypalOrderId: string) {
  return paypalFetch<any>(`/v2/checkout/orders/${paypalOrderId}`);
}

/** A capture carries the order's custom_id, so it is PayPal's own copy of the receipt hash. */
export async function getCapture(captureId: string) {
  return paypalFetch<any>(`/v2/payments/captures/${captureId}`);
}
