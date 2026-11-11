import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { addLedger, emptyDB, mutate, HttpError } from "@/lib/store";
import { readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";

const MIN_TOKEN_LENGTH = 12;

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

/**
 * Team-only reset for the shared demo: clears proposals, orders, disputes, the
 * ledger and rate limits, and restores starting stock. The saved PayPal Vault
 * is kept, so charging still works afterwards. Turned off unless
 * ADMIN_RESET_TOKEN (at least 12 characters) is set on the server.
 */
export const POST = route(async (req: Request) => {
  const expected = process.env.ADMIN_RESET_TOKEN || "";
  if (expected.length < MIN_TOKEN_LENGTH) throw new HttpError(404, "Demo reset is turned off on this server.");

  const { token } = await readJson(req);
  const given = typeof token === "string" ? token : "";
  if (!timingSafeEqual(digest(given), digest(expected))) throw new HttpError(403, "That reset code is not correct.");

  await mutate((db) => {
    const vault = db.vault;
    Object.assign(db, emptyDB(), { vault });
    addLedger(db, { actor: "SYSTEM", eventType: "DEMO_RESET", note: "The team reset the demo. The saved PayPal Vault was kept." });
  });
  return NextResponse.json({ ok: true });
});
