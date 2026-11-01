import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import {
  AlertModel,
  BatchModel,
  InventoryModel,
  movementTypes,
  ProductModel,
  SaleModel,
  StockMovementModel,
  StoreModel,
} from "../src/models";

const store = new Types.ObjectId();
const product = new Types.ObjectId();
const batch = new Types.ObjectId();
const decimal = (value: string) => Types.Decimal128.fromString(value);

function hasIndex(
  schema: { indexes: () => Array<[Record<string, 1 | -1>, Record<string, unknown>]> },
  keys: Record<string, 1 | -1>,
  options: Record<string, unknown> = {},
): boolean {
  return schema.indexes().some(([indexKeys, indexOptions]) => {
    return (
      JSON.stringify(indexKeys) === JSON.stringify(keys) &&
      Object.entries(options).every(([key, value]) => JSON.stringify(indexOptions[key]) === JSON.stringify(value))
    );
  });
}

describe("initial Mongoose models", () => {
  it("validates store fields and currency format", async () => {
    await expect(
      new StoreModel({
        name: " Corner Shop ",
        address: "1 Main Street",
        timezone: "Europe/London",
        currency: "gbp",
      }).validate(),
    ).resolves.toBeUndefined();

    await expect(
      new StoreModel({
        name: "Corner Shop",
        address: "1 Main Street",
        timezone: "Europe/London",
        currency: "US",
      }).validate(),
    ).rejects.toThrow();
  });

  it("requires a store and rejects negative product prices", async () => {
    const invalid = new ProductModel({
      name: "Milk",
      sku: "MILK-1",
      category: "Dairy",
      baseUnit: "litre",
      sellingPrice: decimal("-0.01"),
    });

    await expect(invalid.validate()).rejects.toThrow();
  });

  it("enforces inventory threshold validation without a stored stock total", async () => {
    const valid = new InventoryModel({
      store,
      product,
      minimumStockThreshold: decimal("1.25"),
    });
    await expect(valid.validate()).resolves.toBeUndefined();
    expect(valid.toObject()).not.toHaveProperty("quantity");
    expect(valid.toObject()).not.toHaveProperty("stock");

    const invalid = new InventoryModel({
      store,
      product,
      minimumStockThreshold: decimal("-1"),
    });
    await expect(invalid.validate()).rejects.toThrow();
  });

  it("allows batches without expiry dates and rejects invalid quantities", async () => {
    const valid = new BatchModel({
      store,
      product,
      batchNumber: "B-001",
      receivedQuantity: decimal("12.5"),
      remainingQuantity: decimal("12.5"),
      unitCost: decimal("0.125"),
      receivedDate: new Date("2026-01-01T00:00:00.000Z"),
    });
    await expect(valid.validate()).resolves.toBeUndefined();

    const tooMuchRemaining = new BatchModel({
      store,
      product,
      batchNumber: "B-002",
      receivedQuantity: decimal("1"),
      remainingQuantity: decimal("1.01"),
      unitCost: decimal("1"),
      receivedDate: new Date(),
    });
    await expect(tooMuchRemaining.validate()).rejects.toThrow(/cannot exceed received quantity/i);
  });

  it("rejects negative unit costs", async () => {
    const invalid = new BatchModel({
      store,
      product,
      batchNumber: "B-003",
      receivedQuantity: decimal("1"),
      remainingQuantity: decimal("1"),
      unitCost: decimal("-0.01"),
      receivedDate: new Date(),
    });

    await expect(invalid.validate()).rejects.toThrow();
  });

  it("accepts only valid movement types and nonzero decimal deltas", async () => {
    const valid = new StockMovementModel({
      store,
      product,
      batch,
      movementType: "sale",
      quantityDelta: decimal("-0.25"),
      reason: "Point-of-sale transaction",
    });
    await expect(valid.validate()).resolves.toBeUndefined();

    const invalid = new StockMovementModel({
      store,
      product,
      movementType: "unknown",
      quantityDelta: decimal("0"),
      reason: "Invalid movement",
    });
    await expect(invalid.validate()).rejects.toThrow();
    expect(movementTypes).toContain("sale");
  });

  it("declares scoped uniqueness and lookup indexes", () => {
    expect(hasIndex(ProductModel.schema, { store: 1, sku: 1 }, { unique: true })).toBe(true);
    expect(
      hasIndex(
        ProductModel.schema,
        { store: 1, barcode: 1 },
        { partialFilterExpression: { barcode: { $type: "string" } } },
      ),
    ).toBe(true);
    expect(hasIndex(InventoryModel.schema, { store: 1, product: 1 }, { unique: true })).toBe(true);
    expect(hasIndex(BatchModel.schema, { store: 1, product: 1, batchNumber: 1 }, { unique: true })).toBe(true);
    expect(hasIndex(BatchModel.schema, { store: 1, product: 1, expiryDate: 1 })).toBe(true);
    expect(hasIndex(StockMovementModel.schema, { store: 1, product: 1, timestamp: -1 })).toBe(true);
    expect(
      hasIndex(
        StockMovementModel.schema,
        { store: 1, idempotencyKey: 1 },
        { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } },
      ),
    ).toBe(true);
    expect(hasIndex(StockMovementModel.schema, { store: 1, sale: 1 })).toBe(true);
  });

  it("declares a unique store-scoped alert condition key and query indexes", () => {
    expect(hasIndex(AlertModel.schema, { store: 1, deduplicationKey: 1 }, { unique: true })).toBe(true);
    expect(hasIndex(AlertModel.schema, { store: 1, status: 1, lastDetectedAt: -1 })).toBe(true);
    expect(
      hasIndex(AlertModel.schema, { store: 1, type: 1, status: 1, lastDetectedAt: -1 }),
    ).toBe(true);
  });

  it("indexes completed sales history by store and creation date", () => {
    expect(hasIndex(SaleModel.schema, { store: 1, status: 1, createdAt: 1 })).toBe(true);
  });
});
