#!/usr/bin/env node
/**
 * Wipe local demo data (data/db.json) for a clean recording.
 *
 *   npm run reset
 *
 * Local file storage only. If DATABASE_URL is set (Postgres), nothing is
 * deleted; the script prints how to reset Postgres instead, so a production
 * database can never be wiped by accident.
 */
import fs from "fs";
import path from "path";

function databaseUrlFromEnvFile() {
  for (const file of [path.join(process.cwd(), ".env"), path.join(process.cwd(), "..", ".env")]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = line.trim().match(/^DATABASE_URL\s*=\s*(.*)$/);
      if (m) return m[1].replace(/^["']|["']$/g, "").trim();
    }
  }
  return "";
}

if (process.env.DATABASE_URL || databaseUrlFromEnvFile()) {
  console.log("DATABASE_URL is set, so RelayPay is using Postgres. Nothing was deleted.");
  console.log("To reset Postgres deliberately, run this in your database console:");
  console.log("  DELETE FROM relaypay_store WHERE key = 'db';");
  process.exit(0);
}

const file = path.join(process.cwd(), "data", "db.json");
if (!fs.existsSync(file)) {
  console.log("Nothing to reset: data/db.json doesn't exist yet.");
  process.exit(0);
}
fs.rmSync(file);
console.log("Removed data/db.json. RelayPay starts fresh (stock back to its starting levels) on the next request.");
console.log("Note: PayPal Vault must be connected again from Settings.");
