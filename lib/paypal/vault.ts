import "server-only";
import { paypalFetch } from "./client";

export type VaultSetupTokenResponse = {
  id: string;
  status: string;
  links: { href: string; rel: string; method: string }[];
};

export type VaultPaymentTokenResponse = {
  id: string;
  status: string;
  customer: { id: string };
};

export async function createVaultSetupToken(returnUrl: string, cancelUrl: string, merchantCustomerId: string) {
  return paypalFetch<VaultSetupTokenResponse>("/v3/vault/setup-tokens", {
    method: "POST",
    body: JSON.stringify({
      customer: { merchant_customer_id: merchantCustomerId },
      payment_source: {
        paypal: {
          usage_type: "MERCHANT",
          usage_pattern: "IMMEDIATE",
          customer_type: "CONSUMER",
          experience_context: {
            brand_name: "RelayPay",
            locale: "en-US",
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
        },
      },
    }),
  });
}

export async function exchangeSetupTokenForPaymentToken(setupTokenId: string, _merchantCustomerId: string) {
  return paypalFetch<VaultPaymentTokenResponse>("/v3/vault/payment-tokens", {
    method: "POST",
    body: JSON.stringify({
      payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } },
    }),
  });
}
