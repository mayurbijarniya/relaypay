import { NextResponse } from "next/server";
import { loadDB, storageMode } from "@/lib/store";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * For uptime monitors. The default check is cheap and touches nothing, so a
 * monitor pinging it keeps a sleeping free-tier host awake without extra load.
 * Add ?deep=1 to also confirm the database answers (503 if it does not).
 */
export const GET = route(async (req: Request) => {
  const deep = new URL(req.url).searchParams.get("deep") === "1";
  if (deep) await loadDB();
  return NextResponse.json({ ok: true, storage: storageMode(), ...(deep ? { database: "ok" } : {}) });
});
