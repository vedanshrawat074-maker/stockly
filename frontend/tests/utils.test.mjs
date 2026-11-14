import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatAmount, formatDate, formatQuantity, summarizeSaleProducts } from "../src/lib/utils.ts";
import { normalizeCreateStoreInput } from "../src/lib/store-form.ts";

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

  it("summarizes a single-product sale with its name and quantity", () => {
    assert.deepEqual(summarizeSaleProducts([{ productName: "Basmati Rice", quantity: "3" }]), {
      items: [{ name: "Basmati Rice", quantity: "3" }],
      moreCount: 0,
    });
  });

  it("shows two products and counts remaining products for a multi-product sale", () => {
    assert.deepEqual(summarizeSaleProducts([
      { productName: "Basmati Rice", quantity: "3" },
      { productName: "Toor Dal", quantity: "1.5" },
      { productName: "Sunflower Oil", quantity: "2" },
    ]), {
      items: [
        { name: "Basmati Rice", quantity: "3" },
        { name: "Toor Dal", quantity: "1.5" },
      ],
      moreCount: 1,
    });
  });

  it("uses a readable fallback when a historical line item has no product name", () => {
    assert.deepEqual(summarizeSaleProducts([{ quantity: "2" }]), {
      items: [{ name: "Product name unavailable", quantity: "2" }],
      moreCount: 0,
    });
  });
});

describe("shop creation form input", () => {
  it("normalizes shop fields and preserves the selected business type", () => {
    assert.deepEqual(normalizeCreateStoreInput({
      name: "  Main Street Shop ",
      address: "  1 Main Street ",
      timezone: " Asia/Kolkata ",
      currency: " inr ",
      shopType: "clothing",
    }), {
      name: "Main Street Shop",
      address: "1 Main Street",
      timezone: "Asia/Kolkata",
      currency: "INR",
      shopType: "clothing",
    });
  });
});
