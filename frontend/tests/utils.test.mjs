import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatAmount, formatDate, formatQuantity } from "../src/lib/utils.ts";

describe("Stockly display formatting", () => {
  it("formats INR with Indian grouping and the currency symbol", () => {
    assert.equal(formatAmount("123456.5", "INR"), "₹1,23,456.50");
  });

  it("uses the selected store currency when formatting amounts", () => {
    assert.equal(formatAmount("1234.5", "USD"), "$1,234.50");
  });

  it("formats quantities with Indian grouping without dropping units", () => {
    assert.equal(formatQuantity("123456.125"), "1,23,456.125");
  });

  it("formats valid dates using the consistent Indian date locale", () => {
    assert.equal(formatDate("2026-10-28T00:00:00.000Z"), "28 Oct 2026");
  });
});
