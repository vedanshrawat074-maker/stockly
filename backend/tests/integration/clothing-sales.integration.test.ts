import "dotenv/config";
import mongoose, { Types } from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { ClothingExchangeModel } from "../../src/models/clothing-exchange";
import { ClothingReturnModel } from "../../src/models/clothing-return";
import { ClothingVariantModel } from "../../src/models/clothing-variant";
import { BatchModel } from "../../src/models/batch";
import { ProductModel } from "../../src/models/product";
import { SaleModel } from "../../src/models/sale";
import { StockMovementModel } from "../../src/models/stock-movement";
import { StoreMembershipModel } from "../../src/models/store-membership";
import { StoreModel } from "../../src/models/store";
import { UserModel } from "../../src/models/user";
import { compareDecimals } from "../../src/utils/decimal-arithmetic";

const TEST_DATABASE = "stockly_test";
const FRONTEND_ORIGIN = "http://localhost:3000";
const testUri = getTestUri();
const app = createApp({
  nodeEnv: "test",
  sessionSecret: "clothing-sales-integration-secret",
  sessionMongoUrl: testUri,
  corsOrigins: [FRONTEND_ORIGIN],
});
let userId: Types.ObjectId | undefined;
const storeIds: Types.ObjectId[] = [];

function getTestUri(): string {
  const raw = process.env.MONGODB_TEST_URI ?? process.env.MONGODB_URI;
  if (!raw) throw new Error("Set MONGODB_TEST_URI for clothing sales integration tests.");
  const uri = new URL(raw);
  if (uri.protocol !== "mongodb:") {
    throw new Error("Clothing sales integration tests require a local mongodb:// URI.");
  }
  const database = decodeURIComponent(uri.pathname.replace(/^\/+/, ""));
  if (process.env.MONGODB_TEST_URI && database !== TEST_DATABASE) {
    throw new Error("MONGODB_TEST_URI must target only stockly_test.");
  }
  if (!process.env.MONGODB_TEST_URI && !["stockly", TEST_DATABASE].includes(database)) {
    throw new Error("MONGODB_URI must target stockly or stockly_test before deriving the test database URI.");
  }
  const hosts = uri.host.split(",").map((host) => host.split(":")[0].replace(/^\[|\]$/g, "").toLowerCase());
  if (hosts.length === 0 || hosts.some((host) => !["localhost", "127.0.0.1", "::1"].includes(host))) {
    throw new Error("Clothing sales integration tests require only local MongoDB hosts.");
  }
  if (uri.searchParams.get("replicaSet") !== "rs0") {
    throw new Error("Clothing sales integration tests require replicaSet=rs0.");
  }
  if (!process.env.MONGODB_TEST_URI) uri.pathname = `/${TEST_DATABASE}`;
  return uri.toString();
}

function withOrigin(builder: request.Test): request.Test {
  return builder.set("Origin", FRONTEND_ORIGIN);
}

async function createStore(
  agent: request.Agent,
  csrfToken: string,
  name: string,
  shopType: "grocery" | "clothing",
): Promise<string> {
  const response = await withOrigin(agent.post("/api/stores"))
    .set("X-CSRF-Token", csrfToken)
    .send({ name, address: "Test address", timezone: "UTC", currency: "USD", shopType });
  expect(response.status).toBe(201);
  const storeId = response.body.data.id as string;
  storeIds.push(new Types.ObjectId(storeId));
  return storeId;
}

async function selectStore(agent: request.Agent, csrfToken: string, storeId: string): Promise<void> {
  await withOrigin(agent.post("/api/stores/current"))
    .set("X-CSRF-Token", csrfToken)
    .send({ storeId })
    .expect(200);
}

describe("clothing sales, returns and exchanges on local MongoDB rs0", () => {
  beforeAll(async () => {
    await mongoose.connect(testUri, { serverSelectionTimeoutMS: 5_000 });
    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    const replicaHosts = Array.isArray(hello.hosts)
      ? hello.hosts.map((host: string) => host.split(":")[0].replace(/^\[|\]$/g, "").toLowerCase())
      : [];
    if (
      mongoose.connection.db!.databaseName !== TEST_DATABASE ||
      hello.setName !== "rs0" ||
      hello.isWritablePrimary !== true ||
      hello.msg === "isdbgrid" ||
      replicaHosts.length !== 1 ||
      replicaHosts.some((host: string) => !["localhost", "127.0.0.1", "::1"].includes(host))
    ) {
      await mongoose.disconnect();
      throw new Error("Refusing clothing sales tests outside a writable local stockly_test rs0 database.");
    }

    await Promise.all([
      UserModel.createIndexes(),
      StoreModel.createIndexes(),
      StoreMembershipModel.createIndexes(),
      ProductModel.createIndexes(),
      ClothingVariantModel.createIndexes(),
      SaleModel.createIndexes(),
      StockMovementModel.createIndexes(),
      ClothingReturnModel.createIndexes(),
      ClothingExchangeModel.createIndexes(),
    ]);
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      if (userId) {
        await mongoose.connection.db!.collection("sessions").deleteMany({
          "session.userId": userId.toHexString(),
        });
      }
      if (storeIds.length > 0) {
        await Promise.all([
          StockMovementModel.deleteMany({ store: { $in: storeIds } }),
          ClothingExchangeModel.deleteMany({ store: { $in: storeIds } }),
          ClothingReturnModel.deleteMany({ store: { $in: storeIds } }),
          SaleModel.deleteMany({ store: { $in: storeIds } }),
          ClothingVariantModel.deleteMany({ store: { $in: storeIds } }),
          BatchModel.deleteMany({ store: { $in: storeIds } }),
          ProductModel.deleteMany({ store: { $in: storeIds } }),
          StoreMembershipModel.deleteMany({ store: { $in: storeIds } }),
          StoreModel.deleteMany({ _id: { $in: storeIds } }),
        ]);
      }
      if (userId) {
        await StoreMembershipModel.deleteMany({ user: userId });
        await UserModel.deleteOne({ _id: userId });
      }
    }
    await app.locals.sessionStore?.close();
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });

  it("sells, returns and exchanges exact variants idempotently and keeps grocery FEFO sales intact", async () => {
    const email = `clothing-sales-${new Types.ObjectId().toHexString()}@example.test`;
    const agent = request.agent(app);
    const registration = await withOrigin(agent.post("/api/auth/register")).send({
      name: "Clothing Sales Owner",
      email,
      password: "correct-horse-battery-1",
    });
    expect(registration.status).toBe(201);
    userId = (await UserModel.findOne({ email }))!._id;
    const csrfToken = registration.body.data.csrfToken as string;
    const clothingStoreId = await createStore(agent, csrfToken, "Clothing Sales Shop", "clothing");

    const productResponse = await withOrigin(agent.post("/api/clothing/products"))
      .set("X-CSRF-Token", csrfToken)
      .send({
        name: "Everyday Tee",
        sku: "TEE-BASE",
        category: "Men",
        sellingPrice: "10",
        variants: [
          { size: "M", colour: "Blue", sku: "TEE-M-BLUE", stockQuantity: "10", lowStockThreshold: "2" },
          { size: "L", colour: "Green", sku: "TEE-L-GREEN", stockQuantity: "5", lowStockThreshold: "1" },
          { size: "S", colour: "Black", sku: "TEE-S-BLACK", stockQuantity: "3", lowStockThreshold: "1" },
        ],
      });
    expect(productResponse.status).toBe(201);
    const productId = productResponse.body.data.product._id as string;
    const variants = productResponse.body.data.variants as Array<{ _id: string; size: string }>;
    const medium = variants.find((variant) => variant.size === "M")!;
    const large = variants.find((variant) => variant.size === "L")!;
    const small = variants.find((variant) => variant.size === "S")!;

    const firstSaleInput = {
      items: [
        { variantId: medium._id, quantity: "3", unitPrice: "10", discountPerUnit: "1" },
        { variantId: large._id, quantity: "2", unitPrice: "15", discountPerUnit: "1" },
      ],
      paymentMethod: "card",
    };
    const saleResponse = await withOrigin(agent.post("/api/clothing/sales"))
      .set("X-CSRF-Token", csrfToken)
      .set("Idempotency-Key", "clothing-sale-multi")
      .send(firstSaleInput);
    expect(saleResponse.status).toBe(201);
    const sale = saleResponse.body.data;
    expect(sale.subtotal).toBe("60");
    expect(sale.discountAmount).toBe("5");
    expect(sale.totalAmount).toBe("55");
    expect(sale.paymentMethod).toBe("card");
    expect(sale.soldAt).toBeTruthy();
    expect(sale.lineItems[0]).toMatchObject({
      product: productId,
      variant: medium._id,
      size: "M",
      colour: "blue",
      unitPrice: "10",
      unitNetPrice: "9",
      returnedQuantity: "0",
      allocations: [],
    });

    const replayedSale = await withOrigin(agent.post("/api/clothing/sales"))
      .set("X-CSRF-Token", csrfToken)
      .set("Idempotency-Key", "clothing-sale-multi")
      .send(firstSaleInput);
    expect(replayedSale.status).toBe(200);
    expect(replayedSale.body.data._id).toBe(sale._id);
    expect((await ClothingVariantModel.findById(medium._id))?.stockQuantity.toString()).toBe("7");
    expect((await ClothingVariantModel.findById(large._id))?.stockQuantity.toString()).toBe("3");
    expect(await StockMovementModel.countDocuments({ store: clothingStoreId, sale: sale._id, movementType: "sale" })).toBe(2);

    const lineM = sale.lineItems.find((line: { size: string }) => line.size === "M");
    const lineL = sale.lineItems.find((line: { size: string }) => line.size === "L");
    const firstReturnBody = {
      saleId: sale._id,
      items: [{ saleLineIndex: sale.lineItems.indexOf(lineM), quantity: "1", condition: "saleable", reason: "Wrong size" }],
      refundPaymentMethod: "upi",
    };
    const firstReturn = await withOrigin(agent.post("/api/clothing/returns"))
      .set("X-CSRF-Token", csrfToken)
      .set("Idempotency-Key", "return-m-1")
      .send(firstReturnBody);
    expect(firstReturn.status).toBe(201);
    expect(firstReturn.body.data.refundAmount).toBe("9");
    const duplicateReturn = await withOrigin(agent.post("/api/clothing/returns"))
      .set("X-CSRF-Token", csrfToken)
      .set("Idempotency-Key", "return-m-1")
      .send(firstReturnBody);
    expect(duplicateReturn.status).toBe(200);
    expect(duplicateReturn.body.data._id).toBe(firstReturn.body.data._id);

    for (const [key, condition] of [["return-m-2", "damaged"], ["return-m-3", "saleable"]]) {
      const response = await withOrigin(agent.post("/api/clothing/returns"))
        .set("X-CSRF-Token", csrfToken)
        .set("Idempotency-Key", key)
        .send({
          saleId: sale._id,
          items: [{
            saleLineIndex: sale.lineItems.indexOf(lineM),
            quantity: "1",
            condition,
            reason: "Customer return",
          }],
          refundPaymentMethod: "cash",
        });
      expect(response.status).toBe(201);
      expect(response.body.data.refundAmount).toBe("9");
    }
    expect((await ClothingVariantModel.findById(medium._id))?.stockQuantity.toString()).toBe("9");

    const fullReturn = await withOrigin(agent.post("/api/clothing/returns"))
      .set("X-CSRF-Token", csrfToken)
      .set("Idempotency-Key", "return-l-full")
      .send({
        saleId: sale._id,
        items: [{
          saleLineIndex: sale.lineItems.indexOf(lineL),
          quantity: "2",
          condition: "saleable",
          reason: "Full return",
        }],
        refundPaymentMethod: "cash",
      });
    expect(fullReturn.status).toBe(201);
    expect(fullReturn.body.data.refundAmount).toBe("28");
    const overReturn = await withOrigin(agent.post("/api/clothing/returns"))
      .set("X-CSRF-Token", csrfToken)
      .set("Idempotency-Key", "return-over")
      .send({
        saleId: sale._id,
        items: [{
          saleLineIndex: sale.lineItems.indexOf(lineM),
          quantity: "0.01",
          condition: "saleable",
          reason: "Exceeds sold quantity",
        }],
        refundPaymentMethod: "cash",
      });
    expect(overReturn.status).toBe(409);
    expect(overReturn.body.error.code).toBe("RETURN_QUANTITY_EXCEEDED");
    expect((await ClothingVariantModel.findById(large._id))?.stockQuantity.toString()).toBe("5");

    const exchangeSale = await withOrigin(agent.post("/api/clothing/sales"))
      .set("X-CSRF-Token", csrfToken)
      .set("Idempotency-Key", "sale-for-upgrade")
      .send({ items: [{ variantId: medium._id, quantity: "1" }], paymentMethod: "cash" });
    expect(exchangeSale.status).toBe(201);
    const exchangeSaleData = exchangeSale.body.data;
    const exchangeInput = {
      saleId: exchangeSaleData._id,
      returnedItems: [{ saleLineIndex: 0, quantity: "1", condition: "saleable", reason: "Size exchange" }],
      replacementItems: [{ variantId: large._id, quantity: "1", unitPrice: "15" }],
      paymentMethod: "cash",
    };
    const exchange = await withOrigin(agent.post("/api/clothing/exchanges"))
      .set("X-CSRF-Token", csrfToken)
      .set("Idempotency-Key", "exchange-upgrade")
      .send(exchangeInput);
    expect(exchange.status).toBe(201);
    expect(exchange.body.data.returnedValue).toBe("10");
    expect(exchange.body.data.replacementValue).toBe("15");
    expect(exchange.body.data.priceDifference).toBe("5");
    expect(exchange.body.data.additionalPaymentAmount).toBe("5");
    expect(exchange.body.data.refundAmount).toBe("0");
    const movementCountAfterExchange = await StockMovementModel.countDocuments({
      store: clothingStoreId,
      sale: exchangeSaleData._id,
    });
    const replayedExchange = await withOrigin(agent.post("/api/clothing/exchanges"))
      .set("X-CSRF-Token", csrfToken)
      .set("Idempotency-Key", "exchange-upgrade")
      .send(exchangeInput);
    expect(replayedExchange.status).toBe(200);
    expect(await StockMovementModel.countDocuments({ store: clothingStoreId, sale: exchangeSaleData._id }))
      .toBe(movementCountAfterExchange);
    expect((await ClothingVariantModel.findById(medium._id))?.stockQuantity.toString()).toBe("9");
    expect((await ClothingVariantModel.findById(large._id))?.stockQuantity.toString()).toBe("4");

    const refundExchangeSale = await withOrigin(agent.post("/api/clothing/sales"))
      .set("X-CSRF-Token", csrfToken)
      .set("Idempotency-Key", "sale-for-refund-exchange")
      .send({ items: [{ variantId: medium._id, quantity: "1" }], paymentMethod: "cash" });
    expect(refundExchangeSale.status).toBe(201);
    const refundExchange = await withOrigin(agent.post("/api/clothing/exchanges"))
      .set("X-CSRF-Token", csrfToken)
      .set("Idempotency-Key", "exchange-refund")
      .send({
        saleId: refundExchangeSale.body.data._id,
        returnedItems: [{ saleLineIndex: 0, quantity: "1", condition: "damaged", reason: "Defect" }],
        replacementItems: [{ variantId: large._id, quantity: "1", unitPrice: "5" }],
        refundPaymentMethod: "upi",
      });
    expect(refundExchange.status).toBe(201);
    expect(refundExchange.body.data.priceDifference).toBe("-5");
    expect(refundExchange.body.data.additionalPaymentAmount).toBe("0");
    expect(refundExchange.body.data.refundAmount).toBe("5");

    const concurrentSales = await Promise.all([
      withOrigin(agent.post("/api/clothing/sales"))
        .set("X-CSRF-Token", csrfToken)
        .set("Idempotency-Key", "concurrent-variant-sale-a")
        .send({ items: [{ variantId: small._id, quantity: "2" }], paymentMethod: "cash" }),
      withOrigin(agent.post("/api/clothing/sales"))
        .set("X-CSRF-Token", csrfToken)
        .set("Idempotency-Key", "concurrent-variant-sale-b")
        .send({ items: [{ variantId: small._id, quantity: "2" }], paymentMethod: "cash" }),
    ]);
    expect(concurrentSales.map((response) => response.status).sort()).toEqual([201, 409]);
    expect((await ClothingVariantModel.findById(small._id))?.stockQuantity.toString()).toBe("1");

    const concurrentAdjustments = await Promise.all([
      withOrigin(agent.post(`/api/clothing/variants/${small._id}/adjustments`))
        .set("X-CSRF-Token", csrfToken)
        .send({ quantityDelta: "-1", reason: "Concurrent count A" }),
      withOrigin(agent.post(`/api/clothing/variants/${small._id}/adjustments`))
        .set("X-CSRF-Token", csrfToken)
        .send({ quantityDelta: "-1", reason: "Concurrent count B" }),
    ]);
    expect(concurrentAdjustments.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await ClothingVariantModel.findById(small._id))?.stockQuantity.toString()).toBe("0");

    const concurrentReturnSale = await withOrigin(agent.post("/api/clothing/sales"))
      .set("X-CSRF-Token", csrfToken)
      .set("Idempotency-Key", "sale-for-concurrent-return")
      .send({ items: [{ variantId: medium._id, quantity: "1" }], paymentMethod: "cash" });
    expect(concurrentReturnSale.status).toBe(201);
    const returnRequest = (key: string) => withOrigin(agent.post("/api/clothing/returns"))
      .set("X-CSRF-Token", csrfToken)
      .set("Idempotency-Key", key)
      .send({
        saleId: concurrentReturnSale.body.data._id,
        items: [{ saleLineIndex: 0, quantity: "1", condition: "saleable", reason: "Concurrent return" }],
        refundPaymentMethod: "cash",
      });
    const concurrentReturns = await Promise.all([
      returnRequest("concurrent-return-a"),
      returnRequest("concurrent-return-b"),
    ]);
    expect(concurrentReturns.map((response) => response.status).sort()).toEqual([201, 409]);

    const saleList = await agent.get("/api/clothing/sales?page=1&limit=100");
    expect(saleList.status).toBe(200);
    expect(saleList.body.data.length).toBeGreaterThanOrEqual(5);
    expect((await agent.get(`/api/clothing/sales/${sale._id}`)).status).toBe(200);
    const returnList = await agent.get(`/api/clothing/returns?saleId=${sale._id}`);
    expect(returnList.status).toBe(200);
    expect(returnList.body.data).toHaveLength(4);
    expect((await agent.get(`/api/clothing/returns/${firstReturn.body.data._id}`)).status).toBe(200);
    expect((await agent.get("/api/clothing/exchanges")).body.data).toHaveLength(2);
    expect((await agent.get(`/api/clothing/exchanges/${exchange.body.data._id}`)).status).toBe(200);

    const otherClothingStoreId = await createStore(agent, csrfToken, "Other Clothing Store", "clothing");
    expect((await agent.get(`/api/clothing/sales/${sale._id}`)).status).toBe(404);
    expect(await SaleModel.countDocuments({ store: otherClothingStoreId })).toBe(0);
    expect(await ProductModel.countDocuments({ store: otherClothingStoreId })).toBe(0);
    const unauthorized = await request(app).get(`/api/clothing/sales/${sale._id}`);
    expect(unauthorized.status).toBe(401);

    const groceryStoreId = await createStore(agent, csrfToken, "Grocery Regression Store", "grocery");
    const groceryProduct = await ProductModel.create({
      store: new Types.ObjectId(groceryStoreId),
      name: "Grocery Regression Product",
      sku: `GROCERY-${new Types.ObjectId().toHexString()}`,
      category: "Pantry",
      baseUnit: "each",
      sellingPrice: Types.Decimal128.fromString("2"),
      isActive: true,
    });
    const groceryBatch = await BatchModel.create({
      store: new Types.ObjectId(groceryStoreId),
      product: groceryProduct._id,
      batchNumber: "GROCERY-LOT-1",
      receivedQuantity: Types.Decimal128.fromString("2"),
      remainingQuantity: Types.Decimal128.fromString("2"),
      unitCost: Types.Decimal128.fromString("1"),
      receivedDate: new Date(),
    });
    const grocerySale = await withOrigin(agent.post("/api/sales"))
      .set("X-CSRF-Token", csrfToken)
      .set("Idempotency-Key", `grocery-regression-${new Types.ObjectId().toHexString()}`)
      .send({ items: [{ productId: groceryProduct._id.toHexString(), quantity: "1" }] });
    expect(grocerySale.status).toBe(201);
    expect(compareDecimals((await BatchModel.findById(groceryBatch._id))!.remainingQuantity, "1")).toBe(0);
  });
});
