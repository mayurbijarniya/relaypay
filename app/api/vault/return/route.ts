import { NextResponse } from "next/server";
import { exchangeSetupTokenForPaymentToken } from "@/lib/paypal/vault";
import { addLedger, loadDB, mutate } from "@/lib/store";
import { readablePayPalError } from "@/lib/http";

/**
 * PayPal sends the buyer here after they approve Vault. RelayPay exchanges the
 * setup token for a payment token and returns the buyer to Settings.
 */
export async function GET(req: Request) {
  const origin = (process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin).replace(/\/$/, "");
  const back = (state: string, reason?: string) =>
    NextResponse.redirect(`${origin}/app?vault=${state}${reason ? `&reason=${encodeURIComponent(reason.slice(0, 200))}` : ""}#settings`);

  const params = new URL(req.url).searchParams;
  const snapshot = await loadDB();
  // Prefer the token RelayPay created and stored itself; PayPal also echoes it
  // under different names depending on the approval flow.
  const token =
    snapshot.vault.setupTokenId ||
    params.get("approval_token_id") ||
    params.get("token") ||
    params.get("setup_token") ||
    params.get("setup_token_id") ||
    "";
  if (!token) return back("missing");

  try {
    const paymentToken = await exchangeSetupTokenForPaymentToken(token, snapshot.vault.merchantCustomerId || "relaypay-cafe-owner");
    await mutate((db) => {
      db.vault.vaultId = paymentToken.id;
      db.vault.status = "ACTIVE";
      db.vault.approvedAt = new Date().toISOString();
      delete db.vault.setupTokenId;
      delete db.vault.approveLink;
      addLedger(db, { actor: "PAYPAL", eventType: "VAULT_CONNECTED", note: "Buyer approved PayPal Vault; payment method saved" });
    });
    return back("ready");
  } catch (e: any) {
    return back("failed", readablePayPalError(e?.message || "exchange failed"));
  }
}
