import "dotenv/config";
import mongoose, { Types } from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { BatchModel } from "../../src/models/batch";
import { ProductModel } from "../../src/models/product";
import { SaleModel } from "../../src/models/sale";
import { StockMovementModel } from "../../src/models/stock-movement";
import { StoreModel } from "../../src/models/store";
import { createSale } from "../../src/services/sale-service";
import { compareDecimals } from "../../src/utils/decimal-arithmetic";

const TEST_DATABASE = "stockly_test";
const EXPECTED_REPLICA_SET = "rs0";
const app = createApp({ nodeEnv: "development" });

let storeId: Types.ObjectId;
let productId: Types.ObjectId;
function getTestUri(): string {
  const uri = process.env.MONGODB_TEST_URI;
  const sourceUri = uri ?? process.env.MONGODB_URI;
  if (!sourceUri) throw new Error("Set MONGODB_TEST_URI or MONGODB_URI for integration tests.");

  let parsed: URL;
  try {
    parsed = new URL(sourceUri);
  } catch {
    throw new Error("The integration MongoDB URI is not valid.");
  }

  if (parsed.protocol !== "mongodb:" && parsed.protocol !== "mongodb+srv:") {
    throw new Error("The integration MongoDB URI must use the mongodb or mongodb+srv protocol.");
  }
  const configuredDatabase = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (uri && configuredDatabase !== TEST_DATABASE) {
    throw new Error(`MONGODB_TEST_URI must target only the dedicated ${TEST_DATABASE} database.`);
  }
  if (!uri && configuredDatabase !== "stockly" && configuredDatabase !== TEST_DATABASE) {
    throw new Error("MONGODB_URI must target stockly or stockly_test before deriving the test database URI.");
  }
  if (!uri) {
    parsed.pathname = `/${TEST_DATABASE}`;
  }

  const hosts = parsed.host
    .split(",")
    .map((host) => host.slice(host.lastIndexOf("@") + 1).split(":")[0].replace(/^\[|\]$/g, "").toLowerCase());
  if (
    hosts.length === 0 ||
    hosts.some((host) => !["localhost", "127.0.0.1", "::1"].includes(host))
  ) {
    throw new Error("The integration MongoDB URI must target a local MongoDB deployment.");
  }
  if (parsed.searchParams.get("replicaSet") !== EXPECTED_REPLICA_SET) {
    throw new Error(`The integration MongoDB URI must explicitly select replicaSet=${EXPECTED_REPLICA_SET}.`);
  }

  return parsed.toString();
}

function decimal(value: string): Types.Decimal128 {
  return Types.Decimal128.fromString(value);
}

function decimalNumber(value: Types.Decimal128): string {
  return value.toString();
}

async function seedProduct(): Promise<void> {
  const store = await StoreModel.create({
    name: "Integration Store",
    address: "Test address",
    timezone: "UTC",
    currency: "USD",
  });
  storeId = store._id;

  const product = await ProductModel.create({
    store: storeId,
    name: "Integration Product",
    sku: `SKU-${new Types.ObjectId().toHexString()}`,
    category: "Test",
    baseUnit: "each",
    sellingPrice: decimal("0.10"),
    isActive: true,
  });
  productId = product._id;
}

async function seedBatch(
  batchNumber: string,
  quantity: string,
  options: { expiryDate?: Date; receivedDate?: Date } = {},
) {
  return BatchModel.create({
    store: storeId,
    product: productId,
    batchNumber,
    receivedQuantity: decimal(quantity),
    remainingQuantity: decimal(quantity),
    unitCost: decimal("0.03"),
    receivedDate: options.receivedDate ?? new Date("2026-01-01T00:00:00.000Z"),
    ...(options.expiryDate ? { expiryDate: options.expiryDate } : {}),
  });
}

function saleRequest(
  items: Array<{ productId: string; quantity: string }>,
  idempotencyKey: string,
) {
  return request(app)
    .post("/api/sales")
    .set("X-Store-Id", storeId.toHexString())
    .set("Idempotency-Key", idempotencyKey)
    .send({ items });
}

async function assertNoOversellAndMovementParity(): Promise<void> {
  const [batches, sales, movements] = await Promise.all([
    BatchModel.find({ store: storeId }).lean(),
    SaleModel.find({ store: storeId }).lean(),
    StockMovementModel.find({ store: storeId, movementType: "sale" }).lean(),
  ]);
  const batchById = new Map(batches.map((batch) => [batch._id.toHexString(), batch]));
  const expectedMovements = new Map<string, number>();

  for (const sale of sales) {
    for (const line of sale.lineItems) {
      for (const allocation of line.allocations) {
            const key = `${sale.saleIdentifier}|${line.product.toHexString()}|${allocation.batch.toHexString()}`;
        expectedMovements.set(
          key,
          (expectedMovements.get(key) ?? 0) + 1,
        );
        const expectedDelta = decimal(`-${allocation.quantity.toString()}`);
        const matching = movements.filter(
          (movement) =>
            movement.sale?.equals(sale._id) &&
            movement.reason === `Sale ${sale.saleIdentifier}` &&
            movement.product.equals(line.product) &&
            movement.batch?.equals(allocation.batch) &&
            movement.quantityDelta.toString() === expectedDelta.toString(),
        );
        expect(matching).toHaveLength(1);
      }
    }
  }

  expect(movements).toHaveLength([...expectedMovements.values()].reduce((sum, count) => sum + count, 0));
  for (const batch of batches) {
    expect(compareDecimals(batch.remainingQuantity, "0")).toBeGreaterThanOrEqual(0);
    expect(compareDecimals(batch.remainingQuantity, batch.receivedQuantity)).toBeLessThanOrEqual(0);
  }
}

function hasRetryableTransactionLabel(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "hasErrorLabel" in error &&
    typeof (error as { hasErrorLabel?: unknown }).hasErrorLabel === "function" &&
    ((error as { hasErrorLabel(label: string): boolean }).hasErrorLabel("TransientTransactionError") ||
      (error as { hasErrorLabel(label: string): boolean }).hasErrorLabel("UnknownTransactionCommitResult"))
  );
}

describe("Sales API on a real MongoDB replica set", () => {
  beforeAll(async () => {
    await mongoose.connect(getTestUri(), {
      serverSelectionTimeoutMS: 5_000,
      appName: "stockly-sales-integration-tests",
    });

    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    const replicaHosts = Array.isArray(hello.hosts)
      ? hello.hosts.map((host: string) => host.split(":")[0].replace(/^\[|\]$/g, "").toLowerCase())
      : [];
    if (
      hello.setName !== EXPECTED_REPLICA_SET ||
      hello.msg === "isdbgrid" ||
      hello.isWritablePrimary !== true ||
      replicaHosts.length !== 1 ||
      replicaHosts.some((host: string) => !["localhost", "127.0.0.1", "::1"].includes(host))
    ) {
      await mongoose.disconnect();
      throw new Error(
        `Refusing integration cleanup: server is not a writable, single-node local ${EXPECTED_REPLICA_SET} replica set.`,
      );
    }

    const databaseName = mongoose.connection.db!.databaseName;
    if (databaseName !== TEST_DATABASE || databaseName === "stockly") {
      await mongoose.disconnect();
      throw new Error(`Refusing integration cleanup on unexpected database "${databaseName}".`);
    }

    await mongoose.connection.db!.dropDatabase();
    const models = [StoreModel, ProductModel, BatchModel, SaleModel, StockMovementModel];
    await Promise.all(models.map((model) => model.createCollection()));
    await Promise.all(models.map((model) => model.createIndexes()));
  });

  beforeEach(async () => {
    await mongoose.connection.db!.command({ collMod: "stockmovements", validator: {} });
    await mongoose.connection.db!.command({ collMod: "sales", validator: {} });
    await Promise.all([
      StockMovementModel.deleteMany({}),
      SaleModel.deleteMany({}),
      BatchModel.deleteMany({}),
      ProductModel.deleteMany({}),
      StoreModel.deleteMany({}),
    ]);
    await seedProduct();
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db?.databaseName === TEST_DATABASE) {
      await mongoose.connection.db.dropDatabase();
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  it("creates a sale with FEFO allocations, excludes expired stock, snapshots price, and updates batches", async () => {
    const expired = await seedBatch("expired", "10", {
      expiryDate: new Date(Date.now() - 86_400_000),
    });
    const soon = await seedBatch("soon", "0.2", {
      expiryDate: new Date(Date.now() + 86_400_000),
    });
    const later = await seedBatch("later", "0.5", {
      expiryDate: new Date(Date.now() + 2 * 86_400_000),
    });
    const noExpiry = await seedBatch("no-expiry", "1");

    const response = await saleRequest([{ productId: productId.toHexString(), quantity: "0.3" }], "fefo-success");
    expect(response.status).toBe(201);
    expect(response.body.data.totalAmount).toBe("0.03");
    expect(response.body.data.lineItems[0].unitPrice).toBe("0.10");
    expect(response.body.data.lineItems[0].allocations).toMatchObject([
      { batch: soon._id.toHexString(), quantity: "0.2" },
      { batch: later._id.toHexString(), quantity: "0.1" },
    ]);
    expect((await BatchModel.findById(expired._id))!.remainingQuantity.toString()).toBe("10");
    expect((await BatchModel.findById(soon._id))!.remainingQuantity.toString()).toBe("0.0");
    expect((await BatchModel.findById(later._id))!.remainingQuantity.toString()).toBe("0.4");
    expect((await BatchModel.findById(noExpiry._id))!.remainingQuantity.toString()).toBe("1");

    await ProductModel.updateOne({ _id: productId }, { $set: { sellingPrice: decimal("0.25") } });
    const secondBatch = await seedBatch("next", "1", {
      expiryDate: new Date(Date.now() + 3 * 86_400_000),
    });
    const second = await saleRequest(
      [{ productId: productId.toHexString(), quantity: "1" }],
      "price-snapshot",
    );
    expect(second.status).toBe(201);
    expect(second.body.data.lineItems[0].unitPrice).toBe("0.25");
    expect(second.body.data.lineItems[0].allocations).toMatchObject([
      { batch: later._id.toHexString(), quantity: "0.4" },
      { batch: secondBatch._id.toHexString(), quantity: "0.6" },
    ]);
    expect((await BatchModel.findById(secondBatch._id))!.remainingQuantity.toString()).toBe("0.4");

    const noExpirySale = await saleRequest(
      [{ productId: productId.toHexString(), quantity: "0.5" }],
      "no-expiry-fallback",
    );
    expect(noExpirySale.status).toBe(201);
    expect(noExpirySale.body.data.lineItems[0].allocations).toMatchObject([
      { batch: secondBatch._id.toHexString(), quantity: "0.4" },
      { batch: noExpiry._id.toHexString(), quantity: "0.1" },
    ]);
    expect((await BatchModel.findById(noExpiry._id))!.remainingQuantity.toString()).toBe("0.9");
    await assertNoOversellAndMovementParity();
  });

  it.each(["sale", "movement"] as const)(
    "rolls back batch updates when the %s write is rejected",
    async (failingWrite) => {
      const batch = await seedBatch(`rollback-${failingWrite}`, "2", {
        expiryDate: new Date(Date.now() + 86_400_000),
      });
      if (failingWrite === "sale") {
        await mongoose.connection.db!.command({
          collMod: "sales",
          validator: { status: { $ne: "completed" } },
          validationLevel: "strict",
          validationAction: "error",
        });
      } else {
        await mongoose.connection.db!.command({
          collMod: "stockmovements",
          validator: { movementType: { $ne: "sale" } },
          validationLevel: "strict",
          validationAction: "error",
        });
      }

      const response = await saleRequest(
        [{ productId: productId.toHexString(), quantity: "1" }],
        `rollback-${failingWrite}`,
      );
      expect(response.status).toBe(500);
      expect((await BatchModel.findById(batch._id))!.remainingQuantity.toString()).toBe("2");
      expect(await SaleModel.countDocuments({ store: storeId })).toBe(0);
      expect(await StockMovementModel.countDocuments({ store: storeId, movementType: "sale" })).toBe(0);
    },
  );

  it("replays the same request and rejects a different body for the same key", async () => {
    await seedBatch("idempotent", "2", { expiryDate: new Date(Date.now() + 86_400_000) });
    const items = [{ productId: productId.toHexString(), quantity: "0.5" }];
    const first = await saleRequest(items, "idempotency-key");
    const replay = await saleRequest(items, "idempotency-key");
    const different = await saleRequest(
      [{ productId: productId.toHexString(), quantity: "0.75" }],
      "idempotency-key",
    );

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.meta.idempotentReplay).toBe(true);
    expect(different.status).toBe(409);
    expect(different.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await SaleModel.countDocuments({ store: storeId })).toBe(1);
    await assertNoOversellAndMovementParity();
  });

  it("does not partially modify database state for insufficient stock or invalid requests", async () => {
    const batch = await seedBatch("insufficient", "0.5", {
      expiryDate: new Date(Date.now() + 86_400_000),
    });
    const before = {
      batch: (await BatchModel.findById(batch._id))!.remainingQuantity.toString(),
      sales: await SaleModel.countDocuments({ store: storeId }),
      movements: await StockMovementModel.countDocuments({ store: storeId, movementType: "sale" }),
    };

    const insufficient = await saleRequest(
      [{ productId: productId.toHexString(), quantity: "1" }],
      "insufficient-stock",
    );
    const invalid = await request(app)
      .post("/api/sales")
      .set("X-Store-Id", storeId.toHexString())
      .set("Idempotency-Key", "invalid-sale")
      .send({ items: [{ productId: "bad-id", quantity: "0" }] });

    expect(insufficient.status).toBe(409);
    expect(invalid.status).toBe(400);
    expect((await BatchModel.findById(batch._id))!.remainingQuantity.toString()).toBe(before.batch);
    expect(await SaleModel.countDocuments({ store: storeId })).toBe(before.sales);
    expect(await StockMovementModel.countDocuments({ store: storeId, movementType: "sale" })).toBe(
      before.movements,
    );
  });

  it("does not oversell under concurrent requests and reconciles every committed sale", async () => {
    await seedBatch("concurrent", "1", { expiryDate: new Date(Date.now() + 86_400_000) });
    const results = await Promise.allSettled([
      createSale(storeId, {
        items: [{ productId: productId.toHexString(), quantity: "0.75" }],
        idempotencyKey: "concurrent-a",
      }),
      createSale(storeId, {
        items: [{ productId: productId.toHexString(), quantity: "0.75" }],
        idempotencyKey: "concurrent-b",
      }),
    ]);

    const committedCount = results.filter(
      (result) => result.status === "fulfilled" && !result.value.replayed,
    ).length;
    expect(committedCount).toBe(1);
    for (const result of results) {
      if (result.status === "rejected") {
        const expectedConflict =
          typeof result.reason === "object" &&
          result.reason !== null &&
          "code" in result.reason &&
          ["INSUFFICIENT_STOCK", "STOCK_CHANGED"].includes(String(result.reason.code));
        const exhaustedRetryableTransaction = hasRetryableTransactionLabel(result.reason);
        if (exhaustedRetryableTransaction) {
          console.warn(
            "MongoDB exhausted retries for one concurrent sale; the other sale must still commit exactly once.",
          );
        }
        expect(expectedConflict || exhaustedRetryableTransaction).toBe(true);
      }
    }

    const batch = await BatchModel.findOne({ store: storeId, product: productId });
    expect(compareDecimals(batch!.remainingQuantity, "0")).toBeGreaterThanOrEqual(0);
    expect(compareDecimals(batch!.remainingQuantity, "1")).toBeLessThanOrEqual(0);
    const committedSales = await SaleModel.find({ store: storeId }).lean();
    expect(committedSales.length).toBe(committedCount);
    await assertNoOversellAndMovementParity();
  });
});
