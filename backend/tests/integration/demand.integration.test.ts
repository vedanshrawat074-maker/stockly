import "dotenv/config";
import mongoose, { Types } from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { BatchModel } from "../../src/models/batch";
import { InventoryModel } from "../../src/models/inventory";
import { ProductModel } from "../../src/models/product";
import { SaleModel } from "../../src/models/sale";
import { StockMovementModel } from "../../src/models/stock-movement";
import { StoreModel } from "../../src/models/store";
import { getDailyDemandHistory } from "../../src/services/demand-history-service";

const TEST_DATABASE = "stockly_test";
const REPLICA_SET = "rs0";
const app = createApp({ nodeEnv: "development" });

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

async function seedStoreAndProduct(name: string) {
  const store = await StoreModel.create({
    name,
    address: "Demand test address",
    timezone: "UTC",
    currency: "USD",
  });
  const product = await ProductModel.create({
    store: store._id,
    name: "Rice",
    sku: `RICE-${new Types.ObjectId().toHexString()}`,
    category: "Grocery",
    baseUnit: "kg",
    sellingPrice: decimal("2.50"),
    isActive: true,
  });
  await InventoryModel.create({
    store: store._id,
    product: product._id,
    minimumStockThreshold: decimal("1"),
  });
  return { store, product };
}

async function seedSale(
  store: Types.ObjectId,
  product: Types.ObjectId,
  quantity: string,
  createdAt: Date,
): Promise<void> {
  const sale = await SaleModel.create({
    store,
    saleIdentifier: `sale-${new Types.ObjectId().toHexString()}`,
    lineItems: [{
      product,
      quantity: decimal(quantity),
      unitPrice: decimal("2.50"),
      lineTotal: decimal("2.50"),
      allocations: [],
    }],
    totalAmount: decimal("2.50"),
    status: "completed",
    idempotencyKey: `key-${new Types.ObjectId().toHexString()}`,
    requestHash: "a".repeat(64),
  });
  await SaleModel.collection.updateOne({ _id: sale._id }, { $set: { createdAt } });
}

describe("daily demand aggregation on real MongoDB", () => {
  beforeAll(async () => {
    await mongoose.connect(getTestUri(), {
      serverSelectionTimeoutMS: 5_000,
      appName: "stockly-demand-integration-tests",
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
      throw new Error(`Refusing integration cleanup: expected writable single-node local ${REPLICA_SET}.`);
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
    ];
    await Promise.all(models.map((model) => model.createCollection()));
    await Promise.all(models.map((model) => model.createIndexes()));
  });

  beforeEach(async () => {
    await Promise.all([
      StockMovementModel.deleteMany({}),
      SaleModel.deleteMany({}),
      BatchModel.deleteMany({}),
      InventoryModel.deleteMany({}),
      ProductModel.deleteMany({}),
      StoreModel.deleteMany({}),
    ]);
    const seeded = await seedStoreAndProduct("Demand store");
    storeId = seeded.store._id;
    productId = seeded.product._id;
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db?.databaseName === TEST_DATABASE) {
      await mongoose.connection.db.dropDatabase();
    }
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });

  it("aggregates same-day fractional sales and uses inclusive UTC day boundaries", async () => {
    await seedSale(storeId, productId, "0.1", new Date("2026-05-01T00:00:00.000Z"));
    await seedSale(storeId, productId, "0.2", new Date("2026-05-01T23:59:59.999Z"));
    await seedSale(storeId, productId, "1", new Date("2026-05-02T00:00:00.000Z"));
    await seedSale(storeId, productId, "5", new Date("2026-04-30T23:59:59.999Z"));

    const result = await getDailyDemandHistory(storeId, {
      startDate: "2026-05-01",
      endDate: "2026-05-02",
      productId: productId.toHexString(),
      page: 1,
      limit: 50,
    });

    expect(result.data[0].dailyDemand).toEqual([
      { date: "2026-05-01", unitsSold: "0.3" },
      { date: "2026-05-02", unitsSold: "1" },
    ]);
    expect(result.data[0].unit).toBe("kg");
    expect(result.data[0].availability).toBeNull();
  });

  it("includes zero-sales days and zero-sales products in store series", async () => {
    await seedSale(storeId, productId, "2", new Date("2026-05-01T12:00:00.000Z"));
    const noSalesProduct = await ProductModel.create({
      store: storeId,
      name: "Flour",
      sku: `FLOUR-${new Types.ObjectId().toHexString()}`,
      category: "Grocery",
      baseUnit: "kg",
      sellingPrice: decimal("1.00"),
      isActive: false,
    });

    const result = await getDailyDemandHistory(storeId, {
      startDate: "2026-05-01",
      endDate: "2026-05-03",
      page: 1,
      limit: 50,
    });

    const rice = result.data.find((item) => item.productId === productId.toHexString());
    const flour = result.data.find((item) => item.productId === noSalesProduct._id.toHexString());
    expect(rice?.dailyDemand).toEqual([
      { date: "2026-05-01", unitsSold: "2" },
      { date: "2026-05-02", unitsSold: "0" },
      { date: "2026-05-03", unitsSold: "0" },
    ]);
    expect(flour?.dailyDemand.map((day) => day.unitsSold)).toEqual(["0", "0", "0"]);
    expect(flour?.isActive).toBe(false);
  });

  it("isolates aggregation by store and returns no product data from another store", async () => {
    const foreign = await seedStoreAndProduct("Foreign demand store");
    await seedSale(foreign.store._id, foreign.product._id, "99", new Date("2026-05-01T12:00:00.000Z"));
    await seedSale(storeId, productId, "1", new Date("2026-05-01T12:00:00.000Z"));

    const response = await request(app)
      .get(`/api/demand/history?startDate=2026-05-01&endDate=2026-05-01&productId=${foreign.product._id}`)
      .set("X-Store-Id", storeId.toHexString());

    expect(response.status).toBe(404);
    const ownStore = await getDailyDemandHistory(storeId, {
      startDate: "2026-05-01",
      endDate: "2026-05-01",
      page: 1,
      limit: 50,
    });
    expect(ownStore.data).toHaveLength(1);
    expect(ownStore.data[0].dailyDemand[0].unitsSold).toBe("1");
  });
});
