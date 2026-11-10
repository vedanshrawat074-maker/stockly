import mongoose, { type ClientSession } from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchModel } from "../src/models/batch";
import { ProductModel } from "../src/models/product";
import { SaleModel, saleStatuses } from "../src/models/sale";
import { StockMovementModel } from "../src/models/stock-movement";
import { compareDecimals } from "../src/utils/decimal-arithmetic";
import { createSale, listSales } from "../src/services/sale-service";
import { planFefoAllocations, type FefoCandidate } from "../src/services/fefo-allocation";

function batch(
  batchNumber: string,
  quantity: string,
  expiryDate?: Date,
  receivedDate = new Date("2026-01-01T00:00:00.000Z"),
): FefoCandidate {
  return {
    _id: new mongoose.Types.ObjectId(),
    remainingQuantity: mongoose.Types.Decimal128.fromString(quantity),
    receivedDate,
    ...(expiryDate ? { expiryDate } : {}),
    batchNumber,
  } as FefoCandidate;
}

describe("FEFO allocation", () => {
  const now = new Date("2026-10-27T00:00:00.000Z");

  it("excludes expired batches and allocates earliest valid expiry first", () => {
    const expired = batch("expired", "10", new Date("2026-10-26T00:00:00.000Z"));
    const laterExpiry = batch("later", "2", new Date("2026-12-01T00:00:00.000Z"));
    const earlierExpiry = batch("earlier", "2", new Date("2026-11-01T00:00:00.000Z"));
    const noExpiry = batch("no-expiry", "10");

    const plan = planFefoAllocations(
      [noExpiry, expired, laterExpiry, earlierExpiry],
      mongoose.Types.Decimal128.fromString("3"),
      now,
    );

    expect(plan.allocations.map((item) => item.batch)).toEqual([earlierExpiry, laterExpiry]);
    expect(plan.allocations.map((item) => item.quantity.toString())).toEqual(["2", "1"]);
    expect(plan.outstanding.toString()).toBe("0");
  });

  it("uses no-expiry stock after all valid-expiry stock and preserves fractional values", () => {
    const expiring = batch("expiring", "0.125", new Date("2026-11-01T00:00:00.000Z"));
    const noExpiry = batch("no-expiry", "0.5");

    const plan = planFefoAllocations(
      [noExpiry, expiring],
      mongoose.Types.Decimal128.fromString("0.3"),
      now,
    );

    expect(plan.allocations.map((item) => item.batch)).toEqual([expiring, noExpiry]);
    expect(plan.allocations.map((item) => item.quantity.toString())).toEqual(["0.125", "0.175"]);
  });

  it("reports shortage without any planned partial allocation", () => {
    const available = batch("available", "0.5");
    const plan = planFefoAllocations(
      [available],
      mongoose.Types.Decimal128.fromString("1"),
      now,
    );

    expect(plan.allocations).toHaveLength(1);
    expect(plan.outstanding.toString()).toBe("0.5");
  });
});

describe("sale schema", () => {
  it("uses Decimal128 sale values and requires nonempty positive line items", async () => {
    const sale = new SaleModel({
      store: new mongoose.Types.ObjectId(),
      saleIdentifier: "sale-1",
      lineItems: [
        {
          product: new mongoose.Types.ObjectId(),
          quantity: mongoose.Types.Decimal128.fromString("0"),
          unitPrice: mongoose.Types.Decimal128.fromString("1.25"),
          lineTotal: mongoose.Types.Decimal128.fromString("0"),
          allocations: [],
        },
      ],
      totalAmount: mongoose.Types.Decimal128.fromString("0"),
      idempotencyKey: "key",
      requestHash: "a".repeat(64),
    });

    await expect(sale.validate()).rejects.toThrow();
    expect(saleStatuses).toEqual(["completed"]);
  });

  it("declares store-scoped sale ID and idempotency uniqueness", () => {
    const indexes = SaleModel.schema.indexes();
    expect(indexes).toContainEqual([{ store: 1, saleIdentifier: 1 }, { unique: true, background: true }]);
    expect(indexes).toContainEqual([{ store: 1, idempotencyKey: 1 }, { unique: true, background: true }]);
  });
});

describe("sale service transaction behavior (mocked MongoDB)", () => {
  let stock: Array<FefoCandidate & { store: mongoose.Types.ObjectId; product: mongoose.Types.ObjectId }>;
  let sales: Array<Record<string, unknown>>;
  let storeId: mongoose.Types.ObjectId;
  let productId: mongoose.Types.ObjectId;
  let transactionTail: Promise<void>;

  beforeEach(() => {
    stock = [];
    sales = [];
    storeId = new mongoose.Types.ObjectId();
    productId = new mongoose.Types.ObjectId();
    transactionTail = Promise.resolve();

    const session = {
      withTransaction: vi.fn(async (operation: (value: ClientSession) => Promise<unknown>) => {
        const run = transactionTail.then(() => operation(session as unknown as ClientSession));
        transactionTail = run.then(() => undefined, () => undefined);
        return run;
      }),
      endSession: vi.fn(async () => undefined),
    };
    vi.spyOn(mongoose, "startSession").mockResolvedValue(session as unknown as ClientSession);

    vi.spyOn(SaleModel, "findOne").mockImplementation(((filter: { idempotencyKey: string }) => ({
      session: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(
        sales.find((sale) => sale.idempotencyKey === filter.idempotencyKey) ?? null,
      ),
    })) as never);

    vi.spyOn(ProductModel, "find").mockImplementation(((() => ({
      session: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        {
          _id: productId,
          name: "Basmati Rice",
          sellingPrice: mongoose.Types.Decimal128.fromString("0.10"),
        },
      ]),
    })) as never));

    vi.spyOn(BatchModel, "find").mockImplementation(((() => ({
      session: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(stock.filter((item) => compareDecimals(item.remainingQuantity, "0") > 0)),
    })) as never));

    vi.spyOn(BatchModel, "findOneAndUpdate").mockImplementation(((filter: {
      _id: mongoose.Types.ObjectId;
      remainingQuantity: { $gte: mongoose.Types.Decimal128 };
    }, update: { $inc: { remainingQuantity: mongoose.Types.Decimal128 } }) => ({
      exec: vi.fn().mockImplementation(async () => {
        const candidate = stock.find((item) => item._id.equals(filter._id));
        if (!candidate || compareDecimals(candidate.remainingQuantity, filter.remainingQuantity.$gte) < 0) {
          return null;
        }
        candidate.remainingQuantity = mongoose.Types.Decimal128.fromString(
          decimalDifference(candidate.remainingQuantity.toString(), update.$inc.remainingQuantity.toString()),
        );
        return candidate;
      }),
    })) as never);

    vi.spyOn(SaleModel, "create").mockImplementation((async (documents: Array<Record<string, unknown>>) => {
      const saved = documents[0] as Record<string, unknown>;
      const sale = { ...saved, _id: new mongoose.Types.ObjectId(), createdAt: new Date() };
      sales.push(sale);
      return [sale];
    }) as never);

    vi.spyOn(StockMovementModel, "insertMany").mockResolvedValue([] as never);
  });

  afterEach(() => vi.restoreAllMocks());

  it("rejects insufficient or expired stock without writing a sale or movement", async () => {
    stock.push({
      ...batch("expired", "10", new Date("2026-01-01T00:00:00.000Z")),
      store: storeId,
      product: productId,
    });

    await expect(
      createSale(storeId, {
        items: [{ productId: productId.toHexString(), quantity: "1" }],
        idempotencyKey: "insufficient",
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK", statusCode: 409 });
    expect(sales).toHaveLength(0);
    expect(StockMovementModel.insertMany).not.toHaveBeenCalled();
  });

  it("records multiple FEFO batch allocations and exact fractional money", async () => {
    const first = batch("first", "0.2", new Date(Date.now() + 60_000));
    const second = batch("second", "0.5", new Date(Date.now() + 120_000));
    stock.push(
      { ...second, store: storeId, product: productId },
      { ...first, store: storeId, product: productId },
    );

    const result = await createSale(storeId, {
      items: [{ productId: productId.toHexString(), quantity: "0.3" }],
      idempotencyKey: "fractional-multi-batch",
    });

    const line = (result.sale as unknown as { lineItems: Array<Record<string, unknown>> }).lineItems[0];
    expect(line.productName).toBe("Basmati Rice");
    expect(line.unitPrice.toString()).toBe("0.10");
    expect(line.lineTotal.toString()).toBe("0.03");
    expect(line.allocations).toEqual([
      { batch: first._id, quantity: mongoose.Types.Decimal128.fromString("0.2") },
      { batch: second._id, quantity: mongoose.Types.Decimal128.fromString("0.1") },
    ]);
    expect(
      compareDecimals(stock.find((item) => item._id.equals(first._id))!.remainingQuantity, "0"),
    ).toBe(0);
    expect(stock.find((item) => item._id.equals(second._id))?.remainingQuantity.toString()).toBe("0.4");
    expect(StockMovementModel.insertMany).toHaveBeenCalledOnce();
    expect(StockMovementModel.insertMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ sale: expect.any(mongoose.Types.ObjectId) }),
      ]),
      expect.any(Object),
    );
  });

  it("replays a duplicate request without a second transaction or stock deduction", async () => {
    const available = batch("one", "2", new Date(Date.now() + 60_000));
    stock.push({ ...available, store: storeId, product: productId });
    const input = {
      items: [{ productId: productId.toHexString(), quantity: "1" }],
      idempotencyKey: "same-request",
    };

    const first = await createSale(storeId, input);
    const initialStock = stock[0].remainingQuantity.toString();
    const second = await createSale(storeId, input);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.sale._id).toEqual(first.sale._id);
    expect(stock[0].remainingQuantity.toString()).toBe(initialStock);
    expect(SaleModel.create).toHaveBeenCalledOnce();
  });

  it("serializes concurrent mocked sales and does not oversell shared stock", async () => {
    const available = batch("shared", "1", new Date(Date.now() + 60_000));
    stock.push({ ...available, store: storeId, product: productId });

    const outcomes = await Promise.allSettled([
      createSale(storeId, {
        items: [{ productId: productId.toHexString(), quantity: "0.75" }],
        idempotencyKey: "concurrent-a",
      }),
      createSale(storeId, {
        items: [{ productId: productId.toHexString(), quantity: "0.75" }],
        idempotencyKey: "concurrent-b",
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(stock[0].remainingQuantity.toString()).toBe("0.25");
    expect(sales).toHaveLength(1);
  });

  it("surfaces transaction failures without persisting sale or movement records", async () => {
    vi.restoreAllMocks();
    const session = {
      withTransaction: vi.fn().mockRejectedValue(
        Object.assign(new Error("Transaction numbers are only allowed on a replica set"), {
          code: 20,
        }),
      ),
      endSession: vi.fn(async () => undefined),
    };
    vi.spyOn(mongoose, "startSession").mockResolvedValue(session as unknown as ClientSession);
    vi.spyOn(SaleModel, "findOne").mockReturnValue({
      exec: vi.fn().mockResolvedValue(null),
    } as never);
    const saleCreate = vi.spyOn(SaleModel, "create");
    const movementCreate = vi.spyOn(StockMovementModel, "insertMany");

    await expect(
      createSale(storeId, {
        items: [{ productId: productId.toHexString(), quantity: "1" }],
        idempotencyKey: "transaction-failure",
      }),
    ).rejects.toMatchObject({ code: "TRANSACTIONS_UNSUPPORTED", statusCode: 503 });
    expect(saleCreate).not.toHaveBeenCalled();
    expect(movementCreate).not.toHaveBeenCalled();
  });
});

describe("sale list product-name compatibility", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses stored name snapshots and store-scoped current names for legacy sale lines", async () => {
    const storeId = new mongoose.Types.ObjectId();
    const snapshotProductId = new mongoose.Types.ObjectId();
    const legacyProductId = new mongoose.Types.ObjectId();
    const deletedProductId = new mongoose.Types.ObjectId();
    const sales = [
      {
        lineItems: [
          { product: snapshotProductId, productName: "Name at sale time", quantity: mongoose.Types.Decimal128.fromString("1") },
          { product: legacyProductId, quantity: mongoose.Types.Decimal128.fromString("2") },
          { product: deletedProductId, quantity: mongoose.Types.Decimal128.fromString("3") },
        ],
      },
    ];
    vi.spyOn(SaleModel, "find").mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(sales),
    } as never);
    vi.spyOn(SaleModel, "countDocuments").mockResolvedValue(1 as never);
    const productQuery = {
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([{ _id: legacyProductId, name: "Current legacy name" }]),
    };
    const findProducts = vi.spyOn(ProductModel, "find").mockReturnValue(productQuery as never);

    const result = await listSales(storeId, { page: 1, limit: 5 });

    expect(findProducts).toHaveBeenCalledWith(expect.objectContaining({
      store: storeId,
      _id: { $in: expect.arrayContaining([legacyProductId, deletedProductId]) },
    }));
    expect(result.data[0].lineItems.map((line) => line.productName)).toEqual([
      "Name at sale time",
      "Current legacy name",
      undefined,
    ]);
  });
});

function decimalDifference(left: string, right: string): string {
  const leftParts = decimalParts(left);
  const rightParts = decimalParts(right);
  const scale = Math.max(leftParts.scale, rightParts.scale);
  const coefficient =
    leftParts.coefficient * 10n ** BigInt(scale - leftParts.scale) +
    rightParts.coefficient * 10n ** BigInt(scale - rightParts.scale);
  let digits = coefficient.toString().padStart(scale + 1, "0");
  if (scale === 0) return digits;
  const point = digits.length - scale;
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

function decimalParts(value: string): { coefficient: bigint; scale: number } {
  const [whole, fraction = ""] = value.split(".");
  return { coefficient: BigInt(`${whole}${fraction}`), scale: fraction.length };
}
