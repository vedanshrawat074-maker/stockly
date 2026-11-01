import "dotenv/config";
import mongoose, { Types } from "mongoose";
import request from "supertest";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createApp } from "../../src/app";
import { BatchModel } from "../../src/models/batch";
import { InventoryModel } from "../../src/models/inventory";
import { ProductModel } from "../../src/models/product";
import { SaleModel } from "../../src/models/sale";
import { StockMovementModel } from "../../src/models/stock-movement";
import { StoreModel } from "../../src/models/store";

const TEST_DATABASE = "stockly_test";
const REPLICA_SET = "rs0";
const LIVE_ML = process.env.STOCKLY_E2E_LIVE_ML === "1";
const app = createApp({
  nodeEnv: "development",
  mlServiceUrl: "http://127.0.0.1:8000",
  mlServiceTimeoutMs: 2000,
  restockingPlanningHorizonDays: 7,
  restockingSafetyBufferDays: 2,
});
const ownedStores: Types.ObjectId[] = [];

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
    throw new Error("The integration URI must target a single local MongoDB host.");
  }
  if (uri.searchParams.get("replicaSet") !== REPLICA_SET) {
    throw new Error(`The integration URI must explicitly select replicaSet=${REPLICA_SET}.`);
  }
  return uri.toString();
}

function decimal(value: string): Types.Decimal128 {
  return Types.Decimal128.fromString(value);
}

function previousUtcDate(daysAgo: number): Date {
  const value = new Date();
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() - daysAgo);
  return value;
}

function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function seedStore(name = "Restocking test store") {
  const store = await StoreModel.create({
    name,
    address: "Test-only address",
    timezone: "UTC",
    currency: "USD",
  });
  ownedStores.push(store._id);
  return store;
}

async function seedProduct(
  store: Types.ObjectId,
  options: { active?: boolean; createdDaysAgo?: number; name?: string; threshold?: string } = {},
) {
  const product = await ProductModel.create({
    store,
    name: options.name ?? "Restock Rice",
    sku: `RST-${new Types.ObjectId().toHexString()}`,
    category: "Grocery",
    baseUnit: "kg",
    sellingPrice: decimal("1.25"),
    isActive: options.active ?? true,
    createdAt: previousUtcDate(options.createdDaysAgo ?? 60),
  });
  if (options.threshold !== undefined) {
    await InventoryModel.create({
      store,
      product: product._id,
      minimumStockThreshold: decimal(options.threshold),
    });
  }
  return product;
}

async function seedBatch(
  store: Types.ObjectId,
  product: Types.ObjectId,
  number: string,
  quantity: string,
  expiryDate?: Date,
) {
  return BatchModel.create({
    store,
    product,
    batchNumber: `${number}-${new Types.ObjectId().toHexString()}`,
    receivedQuantity: decimal(quantity),
    remainingQuantity: decimal(quantity),
    unitCost: decimal("0.50"),
    receivedDate: previousUtcDate(60),
    ...(expiryDate ? { expiryDate } : {}),
  });
}

function mockForecast(statusOverride?: "unavailable" | "zero_demand") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (statusOverride === "unavailable") {
        return new Response("service internals must not escape", { status: 503 });
      }
      const body = JSON.parse(String(init?.body)) as {
        history: {
          storeId: string;
          productId: string;
          unit: string;
          dailyDemand: Array<{ date: string; unitsSold: string }>;
        };
        horizonDays: number;
        rollingWindowDays: number;
      };
      const history = body.history.dailyDemand;
      const insufficient = history.length < 14;
      const allZero = statusOverride === "zero_demand";
      const recent = history.slice(-body.rollingWindowDays);
      const recentTotal = recent.reduce((sum, day) => sum + Number(day.unitsSold), 0);
      const average = recent.length === 0 || recentTotal === 0 ? 0.1 : recentTotal / recent.length;
      const lastDate = new Date(`${history[history.length - 1].date}T00:00:00.000Z`);
      const forecasts = insufficient
        ? []
        : Array.from({ length: body.horizonDays }, (_, index) => {
            const date = new Date(lastDate);
            date.setUTCDate(date.getUTCDate() + index + 1);
            return {
              date: dateString(date),
              predictedUnits: String(allZero ? 0 : average),
              previousWeekUnits: null,
            };
          });
      return Response.json({
        storeId: body.history.storeId,
        productId: body.history.productId,
        unit: body.history.unit,
        status: insufficient ? "insufficient_history" : allZero ? "zero_demand" : "ok",
        method: `rolling_average_${body.rollingWindowDays}d`,
        horizonDays: body.horizonDays,
        minimumHistoryDays: 14,
        observedHistoryDays: history.length,
        historyThrough: history[history.length - 1].date,
        forecasts,
        comparison: "Comparator only.",
        limitations: ["Historical availability is unknown."],
      });
    }),
  );
}

describe("restocking recommendations with real MongoDB", () => {
  beforeAll(async () => {
    await mongoose.connect(getTestUri(), {
      serverSelectionTimeoutMS: 5_000,
      appName: "stockly-restocking-integration-tests",
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
      hosts.some((host: string) => !["localhost", "127.0.0.1", "::1"].includes(host)) ||
      mongoose.connection.db!.databaseName !== TEST_DATABASE
    ) {
      await mongoose.disconnect();
      throw new Error(`Refusing integration work outside the dedicated local ${REPLICA_SET}/${TEST_DATABASE} deployment.`);
    }
    await Promise.all([
      StoreModel.createIndexes(),
      ProductModel.createIndexes(),
      InventoryModel.createIndexes(),
      BatchModel.createIndexes(),
      SaleModel.createIndexes(),
      StockMovementModel.createIndexes(),
    ]);
  });

  beforeEach(() => {
    if (!LIVE_ML) mockForecast();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (ownedStores.length > 0) {
      const stores = [...ownedStores];
      ownedStores.length = 0;
      await Promise.all([
        StockMovementModel.deleteMany({ store: { $in: stores } }),
        SaleModel.deleteMany({ store: { $in: stores } }),
        BatchModel.deleteMany({ store: { $in: stores } }),
        InventoryModel.deleteMany({ store: { $in: stores } }),
        ProductModel.deleteMany({ store: { $in: stores } }),
        StoreModel.deleteMany({ _id: { $in: stores } }),
      ]);
    }
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });

  it("sums only usable fractional batch quantities and produces a below-target recommendation", async () => {
    const store = await seedStore();
    const product = await seedProduct(store._id, { threshold: "0.4" });
    await seedBatch(store._id, product._id, "valid-a", "0.2");
    await seedBatch(store._id, product._id, "valid-b", "0.3", previousUtcDate(0));
    await seedBatch(store._id, product._id, "expired", "20", previousUtcDate(1));
    await seedBatch(store._id, product._id, "empty", "0", previousUtcDate(0));
    const movementCount = await StockMovementModel.countDocuments({ store: store._id });
    const inventoryCount = await InventoryModel.countDocuments({ store: store._id });

    const response = await request(app)
      .get(`/api/restocking/recommendations?productId=${product._id}`)
      .set("X-Store-Id", store._id.toHexString());

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      productId: product._id.toHexString(),
      currentUsableStock: "0.5",
      forecastDemand: "0.7",
      safetyBuffer: "0.2",
      suggestedRestockQuantity: "0.4",
      status: "RESTOCK_RECOMMENDED",
    });
    expect(response.body.data[0].reason).toContain("Target stock is 0.9 kg");
    const unchangedBatch = await BatchModel.findOne({
      product: product._id,
      batchNumber: { $regex: /^valid-a/ },
    });
    expect(unchangedBatch!.remainingQuantity.toString()).toBe("0.2");
    expect(await StockMovementModel.countDocuments({ store: store._id })).toBe(movementCount);
    expect(await InventoryModel.countDocuments({ store: store._id })).toBe(inventoryCount);
  });

  it("returns no restock needed when usable stock covers the target; no batches count as zero", async () => {
    const store = await seedStore();
    const stocked = await seedProduct(store._id, { name: "Stocked" });
    const empty = await seedProduct(store._id, { name: "Empty" });
    await seedBatch(store._id, stocked._id, "enough", "1.25");
    const response = await request(app)
      .get("/api/restocking/recommendations?limit=20")
      .set("X-Store-Id", store._id.toHexString());

    const stockedResult = response.body.data.find((item: { productId: string }) => item.productId === stocked._id.toHexString());
    const emptyResult = response.body.data.find((item: { productId: string }) => item.productId === empty._id.toHexString());
    expect(stockedResult).toMatchObject({
      status: "NO_RESTOCK_NEEDED",
      currentUsableStock: "1.25",
      suggestedRestockQuantity: "0",
    });
    expect(emptyResult).toMatchObject({
      status: "RESTOCK_RECOMMENDED",
      currentUsableStock: "0",
      suggestedRestockQuantity: "0.9",
    });
  });

  it("excludes inactive products and isolates product filtering and pagination by store", async () => {
    const store = await seedStore();
    const ownA = await seedProduct(store._id, { name: "A" });
    await seedProduct(store._id, { name: "Inactive", active: false });
    const ownB = await seedProduct(store._id, { name: "B" });
    const foreignStore = await seedStore("Foreign restocking store");
    const foreignProduct = await seedProduct(foreignStore._id, { name: "Foreign" });

    const firstPage = await request(app)
      .get("/api/restocking/recommendations?limit=1")
      .set("X-Store-Id", store._id.toHexString());
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data).toHaveLength(1);
    expect(firstPage.body.data[0].productId).toBe(ownA._id.toHexString());
    expect(firstPage.body.pagination.totalItems).toBe(2);
    expect(firstPage.body.pagination.totalPages).toBe(2);

    const foreignFilter = await request(app)
      .get(`/api/restocking/recommendations?productId=${foreignProduct._id}`)
      .set("X-Store-Id", store._id.toHexString());
    expect(foreignFilter.status).toBe(404);
    const ownFilter = await request(app)
      .get(`/api/restocking/recommendations?productId=${ownB._id}`)
      .set("X-Store-Id", store._id.toHexString());
    expect(ownFilter.status).toBe(200);
    expect(ownFilter.body.data).toHaveLength(1);
    expect(ownFilter.body.data[0].productId).toBe(ownB._id.toHexString());
  });

  it("uses the low-stock threshold only as a separate fallback for cold starts or service outages", async () => {
    const store = await seedStore();
    const young = await seedProduct(store._id, { createdDaysAgo: 3, threshold: "0.5" });
    await seedBatch(store._id, young._id, "threshold-equality", "0.5");
    const response = await request(app)
      .get(`/api/restocking/recommendations?productId=${young._id}`)
      .set("X-Store-Id", store._id.toHexString());

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({
      status: "INSUFFICIENT_HISTORY",
      forecastStatus: "insufficient_history",
      forecastDemand: null,
      safetyBuffer: null,
      suggestedRestockQuantity: null,
      lowStockFallback: { threshold: "0.5", triggered: true },
    });

    mockForecast("unavailable");
    const unavailableProduct = await seedProduct(store._id, { threshold: "1" });
    const unavailable = await request(app)
      .get(`/api/restocking/recommendations?productId=${unavailableProduct._id}`)
      .set("X-Store-Id", store._id.toHexString());
    expect(unavailable.status).toBe(200);
    expect(unavailable.body.data[0]).toMatchObject({
      status: "FORECAST_UNAVAILABLE",
      suggestedRestockQuantity: null,
      lowStockFallback: { threshold: "1", triggered: true },
    });
    expect(JSON.stringify(unavailable.body)).not.toContain("service internals");
  });

  it("returns a zero-demand signal without using threshold as the forecast quantity", async () => {
    mockForecast("zero_demand");
    const store = await seedStore();
    const product = await seedProduct(store._id, { threshold: "2" });
    const response = await request(app)
      .get(`/api/restocking/recommendations?productId=${product._id}`)
      .set("X-Store-Id", store._id.toHexString());
    expect(response.body.data[0]).toMatchObject({
      status: "NO_RESTOCK_NEEDED",
      forecastStatus: "zero_demand",
      forecastDemand: "0",
      safetyBuffer: "0",
      suggestedRestockQuantity: "0",
      lowStockFallback: null,
    });
  });

  it.skipIf(!LIVE_ML)("records test sales through the APIs and reaches live forecast and recommendation routes", async () => {
    vi.unstubAllGlobals();
    const health = await fetch("http://127.0.0.1:8000/health");
    expect(health.status).toBe(200);
    expect((await health.json()).status).toBe("ok");

    const store = await seedStore("Live ML restocking E2E store");
    const productResponse = await request(app)
      .post("/api/products")
      .set("X-Store-Id", store._id.toHexString())
      .send({
        name: "Live Forecast Rice",
        sku: `LIVE-${new Types.ObjectId().toHexString()}`,
        category: "Grocery",
        baseUnit: "kg",
        sellingPrice: "1.25",
      });
    expect(productResponse.status).toBe(201);
    const productId = productResponse.body.data._id as string;
    await ProductModel.collection.updateOne(
      { _id: new Types.ObjectId(productId) },
      { $set: { createdAt: previousUtcDate(60) } },
    );

    const receipt = await request(app)
      .post(`/api/inventory/${productId}/batches`)
      .set("X-Store-Id", store._id.toHexString())
      .send({ batchNumber: "E2E-RESTOCK-BATCH", quantity: "0.5", unitCost: "0.5" });
    expect(receipt.status).toBe(201);

    const sale = await request(app)
      .post("/api/sales")
      .set("X-Store-Id", store._id.toHexString())
      .set("Idempotency-Key", `e2e-${new Types.ObjectId().toHexString()}`)
      .send({ items: [{ productId, quantity: "0.4" }] });
    expect(sale.status).toBe(201);
    const completedDay = previousUtcDate(1);
    completedDay.setUTCHours(12, 0, 0, 0);
    await SaleModel.collection.updateOne(
      { _id: new Types.ObjectId(sale.body.data._id) },
      { $set: { createdAt: completedDay } },
    );

    const forecast = await request(app)
      .post("/api/forecasts")
      .set("X-Store-Id", store._id.toHexString())
      .send({
        productId,
        startDate: dateString(previousUtcDate(30)),
        endDate: dateString(previousUtcDate(1)),
        horizonDays: 7,
      });
    expect(forecast.status).toBe(200);
    expect(forecast.body.data.status).toBe("ok");

    const before = {
      batch: (await BatchModel.findOne({ store: store._id, product: productId }))!.remainingQuantity.toString(),
      movementCount: await StockMovementModel.countDocuments({ store: store._id }),
    };
    const recommendation = await request(app)
      .get(`/api/restocking/recommendations?productId=${productId}`)
      .set("X-Store-Id", store._id.toHexString());
    expect(recommendation.status).toBe(200);
    expect(recommendation.body.data[0].status).toBe("RESTOCK_RECOMMENDED");
    expect(recommendation.body.data[0].suggestedRestockQuantity).not.toBeNull();
    expect((await BatchModel.findOne({ store: store._id, product: productId }))!.remainingQuantity.toString()).toBe(before.batch);
    expect(await StockMovementModel.countDocuments({ store: store._id })).toBe(before.movementCount);
  });
});
