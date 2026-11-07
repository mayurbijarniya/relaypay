import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizePdfText } from "../lib/pdfText.ts";
import { isPayPalVerified, money, reasonLabel, shortId, toolOutputSummary } from "../lib/format.ts";

test("PDF text is reduced to characters the standard PDF font can draw", () => {
  const out = sanitizePdfText("Approved ✓ → paid ≤ $120 — “quoted” • 5 × $24 😀\r\nnext line");
  assert.match(out, /^[\x20-\x7e\n]*$/);
  assert.ok(out.includes("[OK]"));
  assert.ok(out.includes("->"));
  assert.ok(out.includes("<="));
  assert.ok(out.includes("5 x $24"));
  assert.ok(out.includes("\nnext line"));
});

test("accented letters and middle dots stay readable in the PDF", () => {
  assert.equal(sanitizePdfText("Café owner: Café approved · receipt sealed"), "Cafe owner: Cafe approved - receipt sealed");
});

test("dispute reasons read as plain language", () => {
  assert.equal(reasonLabel("UNAUTHORISED"), "Buyer says they didn't authorize this payment");
  assert.equal(reasonLabel("MERCHANDISE_OR_SERVICE_NOT_RECEIVED"), "Buyer says the order never arrived");
  assert.equal(reasonLabel(""), "Dispute reason not provided");
});

test("only PayPal's own records count as verified hash sources", () => {
  assert.equal(isPayPalVerified("PAYPAL_DISPUTE_CUSTOM_ID"), true);
  assert.equal(isPayPalVerified("PAYPAL_CAPTURE_CUSTOM_ID"), true);
  assert.equal(isPayPalVerified("STORED_RECEIPT"), false);
  assert.equal(isPayPalVerified("MISMATCH"), false);
  assert.equal(isPayPalVerified(undefined), false);
});

test("tool summaries describe what happened", () => {
  assert.equal(
    toolOutputSummary({ tool: "verify_hash", output: { matches: true, paypalRecord: "capture" } }),
    "Match · hash found in the PayPal capture record"
  );
  assert.equal(toolOutputSummary({ tool: "check_budget", output: { withinBudget: false, remainingToday: "10.00" } }), "Over budget · only $10.00 left today");
  assert.equal(toolOutputSummary({ tool: "get_low_stock_products", output: { lowStock: [] } }), "Nothing is below its reorder point");
});

test("money and ID formatting", () => {
  assert.equal(money("42"), "$42.00");
  assert.equal(money("abc"), "—");
  assert.equal(shortId("abcdefghijklmnopqrstuvwxyz", 4, 4), "abcd…wxyz");
});
