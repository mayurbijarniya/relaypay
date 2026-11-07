import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CATALOG,
  MAX_QUANTITY,
  centsFromUsd,
  evaluatePolicy,
  initialInventory,
  lowStock,
  matchProduct,
  searchCatalog,
  spentTodayCents,
  stockRow,
} from "../lib/policy.ts";

test("matchProduct finds exact and loosely written catalog names", () => {
  assert.equal(matchProduct("Coffee beans 40lb bag"), "Coffee beans 40lb bag");
  assert.equal(matchProduct("coffee beans 40 lb bag"), "Coffee beans 40lb bag");
  assert.equal(matchProduct("5lb coffee"), "Coffee beans 5lb bag");
  assert.equal(matchProduct("oat milk"), "Oat milk case (12)");
});

test("matchProduct refuses ambiguous or unknown products instead of guessing", () => {
  assert.equal(matchProduct("coffee beans bag"), null, "40lb vs 5lb must not be guessed");
  assert.equal(matchProduct("espresso machine"), null);
  assert.equal(matchProduct(""), null);
});

test("evaluatePolicy recomputes the amount in cents and flags high value", () => {
  const checks = evaluatePolicy({ unitPriceCents: CATALOG["Oat milk case (12)"].priceCents, quantity: 5, spentTodayCents: 0 });
  assert.equal(checks.computedAmount, "120.00");
  assert.equal(checks.highValue, true);
  assert.equal(checks.requiresOwnerConfirmation, true);
  assert.equal(checks.withinDailyCap, true);

  const small = evaluatePolicy({ unitPriceCents: 1200, quantity: 2, spentTodayCents: 0 });
  assert.equal(small.computedAmount, "24.00");
  assert.equal(small.highValue, false);
});

test("evaluatePolicy enforces the daily cap", () => {
  const checks = evaluatePolicy({ unitPriceCents: 4200, quantity: 2, spentTodayCents: 45_000 });
  assert.equal(checks.remainingToday, "50.00");
  assert.equal(checks.withinDailyCap, false);
});

test("evaluatePolicy enforces the quantity limit", () => {
  assert.equal(evaluatePolicy({ unitPriceCents: 100, quantity: MAX_QUANTITY, spentTodayCents: 0 }).withinQuantityLimit, true);
  assert.equal(evaluatePolicy({ unitPriceCents: 100, quantity: MAX_QUANTITY + 1, spentTodayCents: 0 }).withinQuantityLimit, false);
});

test("centsFromUsd avoids floating point drift", () => {
  assert.equal(centsFromUsd(0.1 + 0.2), 30);
  assert.equal(centsFromUsd("42.00"), 4200);
  assert.ok(Number.isNaN(centsFromUsd("abc")));
});

test("stock rules: low stock and a suggested reorder back to the par level", () => {
  const inv = initialInventory();
  const coffee = stockRow("Coffee beans 40lb bag", inv);
  assert.equal(coffee.low, true);
  assert.equal(coffee.suggestedQuantity, CATALOG["Coffee beans 40lb bag"].parLevel - coffee.onHand);
  assert.ok(lowStock(inv).some((r) => r.product === "Coffee beans 40lb bag"));

  const full = { ...inv, "Coffee beans 40lb bag": 10 };
  assert.equal(stockRow("Coffee beans 40lb bag", full).low, false);
  assert.equal(stockRow("Coffee beans 40lb bag", full).suggestedQuantity, 0);
});

test("searchCatalog ranks matches and reports stock", () => {
  const results = searchCatalog("coffee beans");
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.product.startsWith("Coffee beans")));
  assert.equal(searchCatalog("tea").length, 0);
});

test("spentTodayCents only counts today's completed captures", () => {
  const today = new Date().toISOString();
  const orders = [
    { status: "COMPLETED", amount: "42.00", createdAt: today, capturedAt: today },
    { status: "COMPLETED", amount: "10.00", createdAt: "2020-01-01T00:00:00Z", capturedAt: "2020-01-01T00:00:00Z" },
    { status: "PENDING", amount: "99.00", createdAt: today },
  ];
  assert.equal(spentTodayCents(orders), 4200);
});
