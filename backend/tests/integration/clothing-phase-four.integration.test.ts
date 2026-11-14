import "dotenv/config";
import mongoose, { Types } from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { AlertModel } from "../../src/models/alert";
import { BatchModel } from "../../src/models/batch";
import { ClothingExchangeModel } from "../../src/models/clothing-exchange";
import { ClothingReturnModel } from "../../src/models/clothing-return";
import { ClothingVariantModel } from "../../src/models/clothing-variant";
import { ProductModel } from "../../src/models/product";
import { SaleModel } from "../../src/models/sale";
import { StockMovementModel } from "../../src/models/stock-movement";
import { StoreModel } from "../../src/models/store";
import { generateStoreAlerts } from "../../src/services/alert-generation-service";
import { compareDecimals } from "../../src/utils/decimal-arithmetic";

const TEST_DATABASE = "stockly_test";
const app = createApp({ nodeEnv: "development" });
const zero = Types.Decimal128.fromString("0");
const decimal = (value: string) => Types.Decimal128.fromString(value);

function expectDecimal(actual: string, expected: string): void {
  expect(compareDecimals(actual, expected)).toBe(0);
}

let storeId: Types.ObjectId;
let productId: Types.ObjectId;
let variantIds: Types.ObjectId[];

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
  if (uri.searchParams.get("replicaSet") !== "rs0") {
    throw new Error("The integration MongoDB URI must explicitly select replicaSet=rs0.");
  }
  return uri.toString();
}

async function createClothingFixture() {
  const store = await StoreModel.create({
    name: "Clothing analytics integration store",
    address: "Test address",
    timezone: "UTC",
    currency: "USD",
    shopType: "clothing",
  });
  const product = await ProductModel.create({
    store: store._id,
    name: "Everyday Shirt",
    sku: `SHIRT-${new Types.ObjectId().toHexString()}`,
    category: "Men",
    baseUnit: "piece",
    sellingPrice: decimal("10"),
    isActive: true,
  });
  const variants = await ClothingVariantModel.create([
    {
      store: store._id,
      product: product._id,
      size: "M",
      colour: "blue",
      sku: "SHIRT-M-BLUE",
      stockQuantity: decimal("2"),
      lowStockThreshold: decimal("2"),
    },
    {
      store: store._id,
      product: product._id,
      size: "L",
      colour: "blue",
      sku: "SHIRT-L-BLUE",
      stockQuantity: decimal("3"),
      lowStockThreshold: decimal("2"),
    },
    {
      store: store._id,
      product: product._id,
      size: "XL",
      colour: "green",
      sku: "SHIRT-XL-GREEN",
      stockQuantity: decimal("1"),
      lowStockThreshold: decimal("2"),
    },
  ]);
  return { store, product, variants };
}

function saleLine(variant: (typeof variantIds)[number], size: string, quantity: string, price: string) {
  const lineTotal = decimal((Number(quantity) * Number(price)).toFixed(2));
  return {
    product: productId,
    productName: "Everyday Shirt",
    variant,
    variantSku: `SHIRT-${size}-BLUE`,
    size,
    colour: "blue",
    quantity: decimal(quantity),
    unitPrice: decimal(price),
    discountPerUnit: zero,
    unitNetPrice: decimal(price),
    lineTotal,
    returnedQuantity: zero,
    allocations: [],
  };
}

async function createSale(
  date: string,
  variant: Types.ObjectId,
  size: string,
  quantity: string,
  price: string,
) {
  const lineItems = [saleLine(variant, size, quantity, price)];
  const totalAmount = lineItems[0].lineTotal;
  return SaleModel.create({
    store: storeId,
    saleIdentifier: `SALE-${new Types.ObjectId().toHexString()}`,
    lineItems,
    subtotal: totalAmount,
    discountAmount: zero,
    totalAmount,
    status: "completed",
    businessType: "clothing",
    soldAt: new Date(`${date}T12:00:00.000Z`),
    paymentMethod: "cash",
    idempotencyKey: new Types.ObjectId().toHexString(),
    requestHash: "a".repeat(64),
  });
}

describe("clothing Phase 4 alerts and analytics on local MongoDB rs0", () => {
  beforeAll(async () => {
    await mongoose.connect(getTestUri(), {
      serverSelectionTimeoutMS: 5_000,
      appName: "stockly-clothing-phase-four-integration-tests",
    });

    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    const hosts = Array.isArray(hello.hosts)
      ? hello.hosts.map((host: string) => host.split(":")[0].replace(/^\[|\]$/g, "").toLowerCase())
      : [];
    if (
      hello.setName !== "rs0" ||
      hello.msg === "isdbgrid" ||
      hello.isWritablePrimary !== true ||
      hosts.length !== 1 ||
      hosts.some((host: string) => !["localhost", "127.0.0.1", "::1"].includes(host))
    ) {
      await mongoose.disconnect();
      throw new Error("Refusing integration cleanup: expected a writable single-node local rs0 replica set.");
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
      ClothingVariantModel,
      SaleModel,
      ClothingReturnModel,
      ClothingExchangeModel,
      BatchModel,
      AlertModel,
      StockMovementModel,
    ];
    await Promise.all(models.map((model) => model.createCollection()));
    await Promise.all(models.map((model) => model.createIndexes()));
  });

  beforeEach(async () => {
    await Promise.all([
      AlertModel.deleteMany({}),
      StockMovementModel.deleteMany({}),
      ClothingExchangeModel.deleteMany({}),
      ClothingReturnModel.deleteMany({}),
      SaleModel.deleteMany({}),
      BatchModel.deleteMany({}),
      ClothingVariantModel.deleteMany({}),
      ProductModel.deleteMany({}),
      StoreModel.deleteMany({}),
    ]);
    const fixture = await createClothingFixture();
    storeId = fixture.store._id;
    productId = fixture.product._id;
    variantIds = fixture.variants.map((variant) => variant._id);
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db?.databaseName === TEST_DATABASE) {
      await mongoose.connection.db.dropDatabase();
    }
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });

  it("creates one variant alert, resolves on replenishment, reopens on depletion, and skips clothing expiry alerts", async () => {
    await BatchModel.create({
      store: storeId,
      product: productId,
      batchNumber: "CLOTHING-NO-EXPIRY-ALERT",
      receivedQuantity: decimal("2"),
      remainingQuantity: decimal("2"),
      unitCost: decimal("1"),
      receivedDate: new Date("2026-01-01T00:00:00.000Z"),
      expiryDate: new Date("2026-10-28T00:00:00.000Z"),
    });
    const first = await generateStoreAlerts(storeId, { now: new Date("2026-10-27T18:00:00.000Z") });
    const variant = await ClothingVariantModel.findById(variantIds[0]).lean();
    const alert = await AlertModel.findOne({ store: storeId, variant: variantIds[0] });

    expect(first.created).toBe(2);
    expect(alert).toMatchObject({
      productName: "Everyday Shirt",
      variantSku: "SHIRT-M-BLUE",
      size: "M",
      colour: "blue",
      availableStock: decimal("2"),
      lowStockThreshold: decimal("2"),
    });
    expect(await AlertModel.countDocuments({ store: storeId, type: { $ne: "LOW_STOCK" } })).toBe(0);

    const repeated = await Promise.all([
      generateStoreAlerts(storeId, { now: new Date("2026-10-27T18:00:01.000Z") }),
      generateStoreAlerts(storeId, { now: new Date("2026-10-27T18:00:01.000Z") }),
    ]);
    expect(repeated.reduce((count, result) => count + result.activeConditions, 0)).toBeGreaterThan(0);
    expect(await AlertModel.countDocuments({
      store: storeId,
      deduplicationKey: `LOW_STOCK_VARIANT:${variantIds[0].toHexString()}`,
    })).toBe(1);

    const raised = await request(app)
      .post(`/api/clothing/variants/${variantIds[0].toHexString()}/adjustments`)
      .set("X-Store-Id", storeId.toHexString())
      .send({ quantityDelta: "3", reason: "Replenishment" });
    expect(raised.status).toBe(200);
    expect((await AlertModel.findById(alert!._id))?.status).toBe("RESOLVED");

    const lowered = await request(app)
      .post(`/api/clothing/variants/${variantIds[0].toHexString()}/adjustments`)
      .set("X-Store-Id", storeId.toHexString())
      .send({ quantityDelta: "-4", reason: "Stock correction" });
    expect(lowered.status).toBe(200);
    expect((await AlertModel.findById(alert!._id))?.status).toBe("ACTIVE");
    expect((await ClothingVariantModel.findById(variant!._id))?.stockQuantity.toString()).toBe("1");
    expect(await AlertModel.countDocuments({
      store: storeId,
      deduplicationKey: `LOW_STOCK_VARIANT:${variantIds[0].toHexString()}`,
    })).toBe(1);
  });

  it("calculates revenue, net units, size and colour rankings, valuation, and date-filtered trends from records", async () => {
    await createSale("2026-10-01", variantIds[0], "M", "3", "10");
    await createSale("2026-10-02", variantIds[1], "L", "2", "15");
    const saleForReturn = await SaleModel.findOne({ store: storeId, soldAt: new Date("2026-10-01T12:00:00.000Z") });
    const saleForExchange = await SaleModel.findOne({ store: storeId, soldAt: new Date("2026-10-02T12:00:00.000Z") });
    const directReturn = await ClothingReturnModel.create({
      store: storeId,
      originalSale: saleForReturn!._id,
      returnIdentifier: "RETURN-DIRECT",
      returnedAt: new Date("2026-10-03T12:00:00.000Z"),
      lineItems: [{
        saleLineIndex: 0,
        product: productId,
        productName: "Everyday Shirt",
        variant: variantIds[0],
        variantSku: "SHIRT-M-BLUE",
        size: "M",
        colour: "blue",
        quantity: decimal("1"),
        condition: "saleable",
        reason: "Size change",
        lineValue: decimal("10"),
      }],
      refundAmount: decimal("10"),
      refundPaymentMethod: "cash",
      idempotencyKey: "return-direct",
      requestHash: "b".repeat(64),
    });
    const exchangeReturn = await ClothingReturnModel.create({
      store: storeId,
      originalSale: saleForExchange!._id,
      returnIdentifier: "RETURN-EXCHANGE",
      returnedAt: new Date("2026-10-03T12:00:00.000Z"),
      lineItems: [{
        saleLineIndex: 0,
        product: productId,
        productName: "Everyday Shirt",
        variant: variantIds[1],
        variantSku: "SHIRT-L-BLUE",
        size: "L",
        colour: "blue",
        quantity: decimal("1"),
        condition: "saleable",
        reason: "Colour change",
        lineValue: decimal("15"),
      }],
      refundAmount: zero,
      exchangeCreditAmount: decimal("15"),
      idempotencyKey: "return-exchange",
      requestHash: "c".repeat(64),
    });
    const [exchange] = await ClothingExchangeModel.create([{
      store: storeId,
      originalSale: saleForExchange!._id,
      return: exchangeReturn._id,
      exchangeIdentifier: "EXCHANGE-1",
      exchangedAt: new Date("2026-10-03T12:00:00.000Z"),
      replacementItems: [{
        product: productId,
        productName: "Everyday Shirt",
        variant: variantIds[2],
        variantSku: "SHIRT-XL-GREEN",
        size: "XL",
        colour: "green",
        quantity: decimal("1"),
        unitPrice: decimal("20"),
        discountPerUnit: zero,
        lineTotal: decimal("20"),
      }],
      returnedValue: decimal("15"),
      replacementValue: decimal("20"),
      priceDifference: decimal("5"),
      additionalPaymentAmount: decimal("5"),
      refundAmount: zero,
      paymentMethod: "cash",
      idempotencyKey: "exchange-1",
      requestHash: "d".repeat(64),
    }]);
    await ClothingReturnModel.updateOne({ _id: exchangeReturn._id }, { $set: { exchange: exchange._id } });
    expect(directReturn.refundAmount.toString()).toBe("10");

    const response = await request(app)
      .get("/api/clothing/analytics?startDate=2026-10-01&endDate=2026-10-03")
      .set("X-Store-Id", storeId.toHexString());
    const analytics = response.body.data;

    expect(response.status).toBe(200);
    expectDecimal(analytics.revenue.grossSales, "60");
    expectDecimal(analytics.revenue.refunds, "10");
    expectDecimal(analytics.revenue.directReturnRefunds, "10");
    expectDecimal(analytics.revenue.exchangeAdditionalPayments, "5");
    expectDecimal(analytics.revenue.exchangeRefunds, "0");
    expectDecimal(analytics.revenue.netRevenue, "55");
    expectDecimal(analytics.units.grossUnitsSold, "5");
    expectDecimal(analytics.units.returnedUnits, "2");
    expectDecimal(analytics.units.exchangeReplacementUnits, "1");
    expectDecimal(analytics.units.netUnitsSold, "4");
    expect(analytics.transactions).toEqual({ sales: 2, returns: 1, exchanges: 1 });
    expect(analytics.bestSellingSizes[0].size).toBe("M");
    expectDecimal(analytics.bestSellingSizes[0].unitsSold, "2");
    expect(analytics.bestSellingColours[0].colour).toBe("blue");
    expectDecimal(analytics.bestSellingColours[0].unitsSold, "3");
    expect(analytics.bestSellingProducts[0].name).toBe("Everyday Shirt");
    expectDecimal(analytics.bestSellingProducts[0].unitsSold, "4");
    expectDecimal(analytics.bestSellingProducts[0].netRevenue, "55");
    expectDecimal(analytics.currentInventory.retailValue, "60");
    expect(analytics.currentInventory.lowStockVariants).toBe(2);
    expect(analytics.revenueTrend).toHaveLength(3);
    expect(analytics.revenueTrend[2].date).toBe("2026-10-03");
    expectDecimal(analytics.revenueTrend[2].grossSales, "0");
    expectDecimal(analytics.revenueTrend[2].refunds, "10");
    expectDecimal(analytics.revenueTrend[2].exchangeAdditionalPayments, "5");
    expectDecimal(analytics.revenueTrend[2].netRevenue, "-5");

    const filtered = await request(app)
      .get("/api/clothing/analytics?startDate=2026-10-02&endDate=2026-10-02")
      .set("X-Store-Id", storeId.toHexString());
    expect(filtered.status).toBe(200);
    expectDecimal(filtered.body.data.revenue.grossSales, "30");
    expectDecimal(filtered.body.data.units.grossUnitsSold, "2");
    expect(filtered.body.data.revenueTrend).toHaveLength(1);
  });

  it("returns empty analytics for another store without leaking the first store's records", async () => {
    await createSale("2026-10-01", variantIds[0], "M", "3", "10");
    const otherStore = await StoreModel.create({
      name: "Empty clothing store",
      address: "Other address",
      timezone: "UTC",
      currency: "USD",
      shopType: "clothing",
    });

    const response = await request(app)
      .get("/api/clothing/analytics?startDate=2026-10-01&endDate=2026-10-03")
      .set("X-Store-Id", otherStore._id.toHexString());

    expect(response.status).toBe(200);
    expect(response.body.data.revenue).toMatchObject({
      grossSales: "0",
      refunds: "0",
      netRevenue: "0",
    });
    expect(response.body.data.units.netUnitsSold).toBe("0");
    expect(response.body.data.transactions).toEqual({ sales: 0, returns: 0, exchanges: 0 });
    expect(response.body.data.bestSellingProducts).toEqual([]);
    expect(response.body.data.currentInventory).toEqual({ retailValue: "0", lowStockVariants: 0 });
    expect(response.body.data.revenueTrend).toHaveLength(3);
    expect(response.body.data.revenueTrend.every((point: { netRevenue: string }) => point.netRevenue === "0")).toBe(true);
  });
});
