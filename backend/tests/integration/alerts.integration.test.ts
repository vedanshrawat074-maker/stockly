import "dotenv/config";
import mongoose, { Types } from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { AlertModel } from "../../src/models/alert";
import { BatchModel } from "../../src/models/batch";
import { InventoryModel } from "../../src/models/inventory";
import { ProductModel } from "../../src/models/product";
import { SaleModel } from "../../src/models/sale";
import { StockMovementModel } from "../../src/models/stock-movement";
import { StoreModel } from "../../src/models/store";
import { generateStoreAlerts } from "../../src/services/alert-generation-service";
import { compareDecimals } from "../../src/utils/decimal-arithmetic";

const TEST_DATABASE = "stockly_test";
const REPLICA_SET = "rs0";
const app = createApp({ nodeEnv: "development" });
const zero = Types.Decimal128.fromString("0");

let storeId: Types.ObjectId;
let productId: Types.ObjectId;

function getTestUri(): string {
  const configuredUri = process.env.MONGODB_TEST_URI;
  const sourceUri = configuredUri ?? process.env.MONGODB_URI;
  if (!sourceUri) throw new Error("Set MONGODB_TEST_URI or MONGODB_URI for integration tests.");

  let uri: URL;
  try {
    uri = new URL(sourceUri);
  } catch {
    throw new Error("The integration MongoDB URI is not valid.");
  }
  if (!["mongodb:", "mongodb+srv:"].includes(uri.protocol)) {
    throw new Error("The integration MongoDB URI must use mongodb or mongodb+srv.");
  }

  const database = decodeURIComponent(uri.pathname.replace(/^\/+/, ""));
  if (configuredUri && database !== TEST_DATABASE) {
    throw new Error(`MONGODB_TEST_URI must target only ${TEST_DATABASE}.`);
  }
  if (!configuredUri && database !== "stockly" && database !== TEST_DATABASE) {
    throw new Error("MONGODB_URI must target stockly or stockly_test before deriving the test URI.");
  }
  if (!configuredUri) uri.pathname = `/${TEST_DATABASE}`;

  const hosts = uri.host
    .split(",")
    .map((host) => host.slice(host.lastIndexOf("@") + 1).split(":")[0].replace(/^\[|\]$/g, "").toLowerCase());
  if (hosts.length !== 1 || hosts.some((host) => !["localhost", "127.0.0.1", "::1"].includes(host))) {
    throw new Error("The integration MongoDB URI must target a single local MongoDB host.");
  }
  if (uri.searchParams.get("replicaSet") !== REPLICA_SET) {
    throw new Error(`The integration MongoDB URI must explicitly select replicaSet=${REPLICA_SET}.`);
  }
  return uri.toString();
}

function decimal(value: string): Types.Decimal128 {
  return Types.Decimal128.fromString(value);
}

async function createProductInventory(options: {
  name?: string;
  active?: boolean;
  threshold?: string;
  timezone?: string;
} = {}): Promise<{ store: Types.ObjectId; product: Types.ObjectId }> {
  const store = await StoreModel.create({
    name: options.name ?? "Alert integration store",
    address: "Test address",
    timezone: options.timezone ?? "America/Los_Angeles",
    currency: "USD",
  });
  const product = await ProductModel.create({
    store: store._id,
    name: "Apples",
    sku: `SKU-${new Types.ObjectId().toHexString()}`,
    category: "Produce",
    baseUnit: "each",
    sellingPrice: decimal("0.25"),
    isActive: options.active ?? true,
  });
  await InventoryModel.create({
    store: store._id,
    product: product._id,
    minimumStockThreshold: decimal(options.threshold ?? "0"),
  });
  return { store: store._id, product: product._id };
}

async function createBatch(
  store: Types.ObjectId,
  product: Types.ObjectId,
  batchNumber: string,
  quantity: string,
  expiryDate?: string,
) {
  return BatchModel.create({
    store,
    product,
    batchNumber,
    receivedQuantity: decimal(quantity),
    remainingQuantity: decimal(quantity),
    unitCost: decimal("0.10"),
    receivedDate: new Date("2026-01-01T00:00:00.000Z"),
    ...(expiryDate ? { expiryDate: new Date(`${expiryDate}T00:00:00.000Z`) } : {}),
  });
}

const fixedNow = new Date("2026-10-27T18:00:00.000Z");

describe("Alert generation and API on a real MongoDB replica set", () => {
  beforeAll(async () => {
    await mongoose.connect(getTestUri(), {
      serverSelectionTimeoutMS: 5_000,
      appName: "stockly-alert-integration-tests",
    });

    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    const hosts = Array.isArray(hello.hosts)
      ? hello.hosts.map((host: string) => host.split(":")[0].replace(/^\[|\]$/g, "").toLowerCase())
      : [];
    if (
      hello.setName !== REPLICA_SET ||
      hello.msg === "isdbgrid" ||
      hello.isWritablePrimary !== true ||
      hosts.length !== 1 ||
      hosts.some((host: string) => !["localhost", "127.0.0.1", "::1"].includes(host))
    ) {
      await mongoose.disconnect();
      throw new Error(`Refusing integration cleanup: expected a writable single-node local ${REPLICA_SET} replica set.`);
    }

    const db = mongoose.connection.db!;
    if (db.databaseName !== TEST_DATABASE || db.databaseName === "stockly") {
      await mongoose.disconnect();
      throw new Error(`Refusing integration cleanup on unexpected database "${db.databaseName}".`);
    }

    await db.dropDatabase();
    const models = [
      StoreModel,
      ProductModel,
      InventoryModel,
      BatchModel,
      SaleModel,
      StockMovementModel,
      AlertModel,
    ];
    await Promise.all(models.map((model) => model.createCollection()));
    await Promise.all(models.map((model) => model.createIndexes()));
  });

  beforeEach(async () => {
    await mongoose.connection.db!.command({ collMod: "alerts", validator: {} });
    await Promise.all([
      AlertModel.deleteMany({}),
      StockMovementModel.deleteMany({}),
      SaleModel.deleteMany({}),
      BatchModel.deleteMany({}),
      InventoryModel.deleteMany({}),
      ProductModel.deleteMany({}),
      StoreModel.deleteMany({}),
    ]);
    const seeded = await createProductInventory();
    storeId = seeded.store;
    productId = seeded.product;
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db?.databaseName === TEST_DATABASE) {
      await mongoose.connection.db.dropDatabase();
    }
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });

  it("generates yesterday/today/tomorrow expiry alerts using the store-local date", async () => {
    const yesterday = await createBatch(storeId, productId, "yesterday", "1", "2026-10-26");
    const today = await createBatch(storeId, productId, "today", "1", "2026-10-27");
    const tomorrow = await createBatch(storeId, productId, "tomorrow", "1", "2026-10-28");
    const noExpiry = await createBatch(storeId, productId, "no-expiry", "1");
    const zeroQuantity = await createBatch(storeId, productId, "zero", "1", "2026-10-27");
    await BatchModel.updateOne({ _id: zeroQuantity._id }, { $set: { remainingQuantity: zero } });

    await generateStoreAlerts(storeId, { expiryWarningDays: 2, now: fixedNow });
    const alerts = await AlertModel.find({ store: storeId }).lean();
    expect(alerts.filter((alert) => alert.type === "EXPIRED_STOCK").map((alert) => alert.batch!.toHexString()))
      .toEqual([yesterday._id.toHexString()]);
    expect(
      alerts
        .filter((alert) => alert.type === "EXPIRING_SOON")
        .map((alert) => alert.batch!.toHexString())
        .sort(),
    ).toEqual([today._id.toHexString(), tomorrow._id.toHexString()].sort());
    expect(alerts.some((alert) => alert.batch?.equals(noExpiry._id))).toBe(false);
    expect(alerts.some((alert) => alert.batch?.equals(zeroQuantity._id))).toBe(false);
  });

  it("includes the warning-window boundary and excludes the next date", async () => {
    const boundary = await createBatch(storeId, productId, "boundary", "1", "2026-11-03");
    const outside = await createBatch(storeId, productId, "outside", "1", "2026-11-04");

    await generateStoreAlerts(storeId, { expiryWarningDays: 7, now: fixedNow });

    expect(await AlertModel.exists({ store: storeId, batch: boundary._id, type: "EXPIRING_SOON" })).toBeTruthy();
    expect(await AlertModel.exists({ store: storeId, batch: outside._id, type: "EXPIRING_SOON" })).toBeNull();
  });

  it("excludes expired quantities from low-stock calculations and detects equality/below threshold", async () => {
    await InventoryModel.updateOne({ store: storeId, product: productId }, {
      $set: { minimumStockThreshold: decimal("5") },
    });
    await createBatch(storeId, productId, "expired-stock", "10", "2026-10-26");
    const usable = await createBatch(storeId, productId, "usable-stock", "4", "2026-10-27");

    await generateStoreAlerts(storeId, { now: fixedNow });
    let lowStock = await AlertModel.findOne({ store: storeId, type: "LOW_STOCK" });
    expect(lowStock?.details).toContain("4");
    expect(lowStock?.severity).toBe("HIGH");

    await BatchModel.updateOne({ _id: usable._id }, { $set: { remainingQuantity: decimal("5") } });
    await generateStoreAlerts(storeId, { now: fixedNow });
    lowStock = await AlertModel.findOne({ store: storeId, type: "LOW_STOCK" });
    expect(lowStock?.details).toContain("5");
    expect(lowStock?.severity).toBe("MEDIUM");
  });

  it("does not create low-stock alerts for inactive products", async () => {
    await ProductModel.updateOne({ _id: productId }, { $set: { isActive: false } });
    await InventoryModel.updateOne({ store: storeId, product: productId }, {
      $set: { minimumStockThreshold: decimal("5") },
    });

    await generateStoreAlerts(storeId, { now: fixedNow });

    expect(await AlertModel.countDocuments({ store: storeId, type: "LOW_STOCK" })).toBe(0);
  });

  it("refreshes alerts idempotently, resolves stale conditions, and reactivates resolved conditions", async () => {
    const expiring = await createBatch(storeId, productId, "lifecycle", "1", "2026-10-28");
    const first = await generateStoreAlerts(storeId, { now: fixedNow });
    const alert = await AlertModel.findOne({ store: storeId, batch: expiring._id, type: "EXPIRING_SOON" });
    expect(first.created).toBe(1);
    const firstDetected = alert!.firstDetectedAt.getTime();
    const repeated = await generateStoreAlerts(storeId, {
      now: new Date(fixedNow.getTime() + 1_000),
    });
    expect(repeated.created).toBe(0);
    expect(repeated.refreshed).toBe(1);
    expect(await AlertModel.countDocuments({ store: storeId, deduplicationKey: alert!.deduplicationKey })).toBe(1);

    await BatchModel.updateOne({ _id: expiring._id }, { $set: { remainingQuantity: zero } });
    const cleared = await generateStoreAlerts(storeId, { now: new Date(fixedNow.getTime() + 2_000) });
    expect(cleared.resolved).toBe(1);
    expect((await AlertModel.findById(alert!._id))!.status).toBe("RESOLVED");

    await BatchModel.updateOne({ _id: expiring._id }, { $set: { remainingQuantity: decimal("1") } });
    await generateStoreAlerts(storeId, { now: new Date(fixedNow.getTime() + 3_000) });
    const reactivated = await AlertModel.findById(alert!._id);
    expect(reactivated?.status).toBe("ACTIVE");
    expect(reactivated?.resolvedAt).toBeUndefined();
    expect(reactivated?.firstDetectedAt.getTime()).toBeGreaterThan(firstDetected);
  });

  it("serializes concurrent generation without duplicate condition records", async () => {
    await createBatch(storeId, productId, "concurrent", "1", "2026-10-28");
    const results = await Promise.all([
      generateStoreAlerts(storeId, { now: fixedNow }),
      generateStoreAlerts(storeId, { now: fixedNow }),
    ]);

    expect(results.reduce((sum, result) => sum + result.activeConditions, 0)).toBeGreaterThan(0);
    expect(await AlertModel.countDocuments({ store: storeId, deduplicationKey: `EXPIRING_SOON:${(await BatchModel.findOne({ batchNumber: "concurrent" }))!._id}` })).toBe(1);
  });

  it("isolates alert scans to one store", async () => {
    const other = await createProductInventory({ name: "Other store", threshold: "5" });
    const foreignBatch = await createBatch(other.store, other.product, "foreign-expired", "2", "2026-10-26");
    await InventoryModel.updateOne(
      { store: other.store, product: other.product },
      { $set: { minimumStockThreshold: decimal("5") } },
    );

    await generateStoreAlerts(storeId, { now: fixedNow });

    expect(await AlertModel.countDocuments({ store: storeId, batch: foreignBatch._id })).toBe(0);
    expect(await AlertModel.countDocuments({ store: other.store })).toBe(0);
  });

  it("acknowledges and resolves store-scoped alerts and rejects invalid transitions", async () => {
    const batch = await createBatch(storeId, productId, "ack", "1", "2026-10-28");
    await generateStoreAlerts(storeId, { now: fixedNow });
    const alert = await AlertModel.findOne({ store: storeId, batch: batch._id });
    const otherStore = new Types.ObjectId();

    const crossStore = await request(app)
      .patch(`/api/alerts/${alert!._id}/acknowledge`)
      .set("X-Store-Id", otherStore.toHexString());
    const acknowledged = await request(app)
      .patch(`/api/alerts/${alert!._id}/acknowledge`)
      .set("X-Store-Id", storeId.toHexString());
    const duplicateAck = await request(app)
      .patch(`/api/alerts/${alert!._id}/acknowledge`)
      .set("X-Store-Id", storeId.toHexString());
    await generateStoreAlerts(storeId, { now: fixedNow });
    const refreshedAcknowledged = await AlertModel.findById(alert!._id);
    const resolved = await request(app)
      .patch(`/api/alerts/${alert!._id}/resolve`)
      .set("X-Store-Id", storeId.toHexString());
    const invalidReack = await request(app)
      .patch(`/api/alerts/${alert!._id}/acknowledge`)
      .set("X-Store-Id", storeId.toHexString());

    expect(crossStore.status).toBe(404);
    expect(acknowledged.body.data.status).toBe("ACKNOWLEDGED");
    expect(duplicateAck.status).toBe(200);
    expect(refreshedAcknowledged?.status).toBe("ACKNOWLEDGED");
    expect(resolved.body.data.status).toBe("RESOLVED");
    expect(invalidReack.status).toBe(409);
  });

  it("rolls back earlier alert writes when a later alert write violates a database validator", async () => {
    await InventoryModel.updateOne({ store: storeId, product: productId }, {
      $set: { minimumStockThreshold: decimal("5") },
    });
    await createBatch(storeId, productId, "expired-and-low", "1", "2026-10-26");
    await mongoose.connection.db!.command({
      collMod: "alerts",
      validator: { type: { $ne: "EXPIRED_STOCK" } },
      validationLevel: "strict",
      validationAction: "error",
    });

    await expect(generateStoreAlerts(storeId, { now: fixedNow })).rejects.toThrow();
    expect(await AlertModel.countDocuments({ store: storeId })).toBe(0);
  });

  it("does not mix stores when listing filtered alerts", async () => {
    await createBatch(storeId, productId, "list-store", "1", "2026-10-28");
    await generateStoreAlerts(storeId, { now: fixedNow });
    const other = await createProductInventory({ name: "Listing other store" });
    const response = await request(app)
      .get("/api/alerts?type=EXPIRING_SOON&status=ACTIVE")
      .set("X-Store-Id", other.store.toHexString());

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.pagination.totalItems).toBe(0);
  });

  it("uses exact decimal comparisons for persisted quantities", async () => {
    const batch = await createBatch(storeId, productId, "decimal", "0.3");
    await InventoryModel.updateOne({ store: storeId, product: productId }, {
      $set: { minimumStockThreshold: decimal("0.3") },
    });
    await generateStoreAlerts(storeId, { now: fixedNow });
    const lowStock = await AlertModel.findOne({ store: storeId, type: "LOW_STOCK" });

    expect(lowStock?.details).toContain("0.3");
    expect(compareDecimals((await BatchModel.findById(batch._id))!.remainingQuantity, "0.3")).toBe(0);
  });
});
