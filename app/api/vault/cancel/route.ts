import { NextResponse } from "next/server";
import { mutate } from "@/lib/store";

/** PayPal sends the buyer here when they cancel the Vault approval. */
export async function GET(req: Request) {
  const origin = (process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin).replace(/\/$/, "");
  await mutate((db) => {
    delete db.vault.setupTokenId;
    delete db.vault.approveLink;
    if (!db.vault.vaultId) db.vault.status = "CANCELLED";
  }).catch(() => undefined);
  return NextResponse.redirect(`${origin}/app?vault=cancelled#settings`);
}
