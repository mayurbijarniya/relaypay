import { NextResponse } from "next/server";
import { exchangeSetupTokenForPaymentToken } from "@/lib/paypal/vault";
import { addLedger, loadDB, mutate, HttpError } from "@/lib/store";
import { PayPalApiError } from "@/lib/paypal/client";
import { route } from "@/lib/http";

/**
 * Manual fallback for the Vault return URL ("I approved it, finish setup").
 * Uses the setup token RelayPay created and stored; nothing comes from the body.
 */
export const POST = route(async () => {
  const snapshot = await loadDB();
  const setupTokenId = snapshot.vault.setupTokenId;
  if (!setupTokenId) throw new HttpError(400, "No pending Vault approval. Create an approval link first.");

  let token;
  try {
    token = await exchangeSetupTokenForPaymentToken(setupTokenId, snapshot.vault.merchantCustomerId || "relaypay-cafe-owner");
  } catch (e) {
    if (e instanceof PayPalApiError && (e.status === 422 || e.status === 400)) {
      throw new HttpError(409, "PayPal hasn't recorded the approval yet. Open the approval link, log in as the sandbox buyer and approve first.");
    }
    throw e;
  }

  await mutate((db) => {
    db.vault.vaultId = token.id;
    db.vault.status = "ACTIVE";
    db.vault.approvedAt = new Date().toISOString();
    delete db.vault.setupTokenId;
    delete db.vault.approveLink;
    addLedger(db, { actor: "PAYPAL", eventType: "VAULT_CONNECTED", note: "Buyer approved PayPal Vault; payment method saved" });
  });
  return NextResponse.json({ active: true });
});
