import { NextResponse } from "next/server";
import { createVaultSetupToken } from "@/lib/paypal/vault";
import { mutate, HttpError } from "@/lib/store";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { route } from "@/lib/http";

/** Step 1 of Vault: ask PayPal for a one-time setup token and an approval link. */
export const POST = route(async (req: Request) => {
  const ip = clientIp(req);
  await mutate((db) => {
    // Once connected, Vault is locked so a visitor on the public demo can't
    // replace the saved payment method mid-judging.
    if (db.vault.vaultId && process.env.ALLOW_VAULT_RESET !== "true") {
      throw new HttpError(409, "PayPal Vault is already connected and locked for the demo. Set ALLOW_VAULT_RESET=true to reconnect.");
    }
    const limit = checkRateLimit(db, "paypal", ip);
    if (!limit.ok) throw new HttpError(429, limit.reason);
  });

  const merchantCustomerId = "relaypay-cafe-owner";
  const base = (process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin).replace(/\/$/, "");
  const setup = await createVaultSetupToken(`${base}/api/vault/return`, `${base}/api/vault/cancel`, merchantCustomerId);
  const approveLink = setup.links?.find((l) => l.rel === "approve")?.href;
  if (!approveLink) throw new HttpError(502, "PayPal did not return an approval link. Check that Vault is enabled for this sandbox app.");

  await mutate((db) => {
    db.vault.merchantCustomerId = merchantCustomerId;
    db.vault.setupTokenId = setup.id;
    // Kept so the approval link survives a page reload. It only lets a buyer
    // approve saving their own PayPal; it grants nothing to whoever holds it.
    db.vault.approveLink = approveLink;
    // Keep an existing connection usable until the new approval completes.
    if (!db.vault.vaultId) db.vault.status = "PENDING_APPROVAL";
  });

  return NextResponse.json({ approveLink, returnUrl: `${base}/api/vault/return` });
});
