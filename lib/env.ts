import "server-only";
import fs from "fs";
import path from "path";

// Load .env from relaypay/ first, then project root (../.env). Values never logged.
function loadEnvFile(file: string) {
  try {
    if (!fs.existsSync(file)) return;
    const content = fs.readFileSync(file, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(process.cwd(), "..", ".env"));

export const env = {
  paypalClientId: process.env.PAYPAL_CLIENT_ID || "",
  paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET || "",
  paypalEnvironment: process.env.PAYPAL_ENVIRONMENT || "sandbox",
  llmApiKey: process.env.LLM_API_KEY || "",
  /** Sandbox buyer email, used only to open sandbox disputes. Never sent to the browser. */
  sandboxBuyerEmail: process.env.SANDBOX_BUYER_EMAIL || "",
};

export const isSandbox = () => env.paypalEnvironment !== "live";

export function requirePayPalEnv() {
  if (!env.paypalClientId || !env.paypalClientSecret) {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set in .env");
  }
  // RelayPay is a hackathon demo. Refuse live credentials unless the operator
  // explicitly opts in, so a stray PAYPAL_ENVIRONMENT=live cannot charge cards.
  if (env.paypalEnvironment === "live" && process.env.ALLOW_LIVE !== "true") {
    throw new Error(
      "Live PayPal is disabled for this demo. Set ALLOW_LIVE=true only if you intentionally want real charges."
    );
  }
}
