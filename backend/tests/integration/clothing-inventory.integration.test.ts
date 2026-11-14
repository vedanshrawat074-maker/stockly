import "dotenv/config";
import mongoose, { Types } from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { ClothingVariantModel } from "../../src/models/clothing-variant";
import { ProductModel } from "../../src/models/product";
import { StockMovementModel } from "../../src/models/stock-movement";
import { StoreMembershipModel } from "../../src/models/store-membership";
import { StoreModel } from "../../src/models/store";
import { UserModel } from "../../src/models/user";

const TEST_DATABASE = "stockly_test";
const FRONTEND_ORIGIN = "http://localhost:3000";
const testUri = getTestUri();
const app = createApp({
  nodeEnv: "test",
  sessionSecret: "clothing-integration-session-secret",
  sessionMongoUrl: testUri,
  corsOrigins: [FRONTEND_ORIGIN],
});
let userId: Types.ObjectId | undefined;
const storeIds: Types.ObjectId[] = [];

function getTestUri(): string {
  const raw = process.env.MONGODB_TEST_URI ?? process.env.MONGODB_URI;
  if (!raw) throw new Error("Set MONGODB_TEST_URI for clothing inventory integration tests.");
  const uri = new URL(raw);
  if (uri.protocol !== "mongodb:") {
    throw new Error("Clothing inventory integration tests require a local mongodb:// URI.");
  }
  const database = decodeURIComponent(uri.pathname.replace(/^\/+/, ""));
  if (process.env.MONGODB_TEST_URI && database !== TEST_DATABASE) {
    throw new Error("MONGODB_TEST_URI must target only stockly_test.");
  }
  if (!process.env.MONGODB_TEST_URI && !["stockly", TEST_DATABASE].includes(database)) {
    throw new Error("MONGODB_URI must target stockly or stockly_test before deriving the test database URI.");
  }
  const hosts = uri.host
    .split(",")
    .map((host) => host.split(":")[0].replace(/^\[|\]$/g, "").toLowerCase());
  if (hosts.length === 0 || hosts.some((host) => !["localhost", "127.0.0.1", "::1"].includes(host))) {
    throw new Error("Clothing inventory integration tests require a local MongoDB host.");
  }
  if (uri.searchParams.get("replicaSet") !== "rs0") {
    throw new Error("Clothing inventory integration tests require replicaSet=rs0.");
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

describe("clothing inventory API on local MongoDB rs0", () => {
  beforeAll(async () => {
    await mongoose.connect(testUri, { serverSelectionTimeoutMS: 5_000 });
    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    if (
      mongoose.connection.db!.databaseName !== TEST_DATABASE ||
      hello.setName !== "rs0" ||
      hello.isWritablePrimary !== true ||
      hello.msg === "isdbgrid" ||
      !Array.isArray(hello.hosts) ||
      hello.hosts.length !== 1 ||
      !["localhost", "127.0.0.1", "::1"].includes(
        hello.hosts[0].split(":")[0].replace(/^\[|\]$/g, "").toLowerCase(),
      )
    ) {
      await mongoose.disconnect();
      throw new Error("Refusing clothing tests outside a writable local stockly_test rs0 database.");
    }
    await Promise.all([
      UserModel.createIndexes(),
      StoreModel.createIndexes(),
      StoreMembershipModel.createIndexes(),
      ProductModel.createIndexes(),
      ClothingVariantModel.createIndexes(),
      StockMovementModel.createIndexes(),
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
          StockMovementModel.deleteMany({ store: { $in: storeIds }, variant: { $exists: true } }),
          ClothingVariantModel.deleteMany({ store: { $in: storeIds } }),
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

  it("creates and isolates clothing variants, adjusts stock safely, and refuses grocery operations", async () => {
    const email = `clothing-${new Types.ObjectId().toHexString()}@example.test`;
    const agent = request.agent(app);
    const registration = await withOrigin(agent.post("/api/auth/register")).send({
      name: "Clothing Owner",
      email,
      password: "correct-horse-battery-1",
    });
    expect(registration.status).toBe(201);
    userId = (await UserModel.findOne({ email }))!._id;
    const csrfToken = registration.body.data.csrfToken as string;

    const clothingStoreId = await createStore(agent, csrfToken, "Clothing Shop", "clothing");
    const createProduct = await withOrigin(agent.post("/api/clothing/products"))
      .set("X-CSRF-Token", csrfToken)
      .send({
        name: "Everyday Shirt",
        sku: "SHIRT-1",
        category: "Men",
        sellingPrice: "25.00",
        variants: [
          {
            size: "M",
            colour: "Navy Blue",
            designIdentifier: "FW26",
            sku: "SHIRT-M-NAVY",
            stockQuantity: "8",
            lowStockThreshold: "3",
          },
          {
            size: "M",
            colour: "Blue",
            sku: "SHIRT-M-BLUE",
            stockQuantity: "2",
            lowStockThreshold: "2",
          },
        ],
      });
    expect(createProduct.status).toBe(201);
    const productId = createProduct.body.data.product._id as string;
    const [navyVariant, blueVariant] = createProduct.body.data.variants as Array<{ _id: string; stockQuantity: string }>;
    expect(createProduct.body.data.product.baseUnit).toBe("piece");
    expect(createProduct.body.data.product.category).toBe("Men");
    expect(navyVariant.stockQuantity).toBe("8");
    expect(blueVariant.stockQuantity).toBe("2");

    const listed = await agent.get(`/api/clothing/products/${productId}/variants`);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(2);
    expect(listed.body.data.map((variant: { stockQuantity: string }) => variant.stockQuantity)).toEqual(["2", "8"]);

    const categoryChange = await withOrigin(agent.patch(`/api/products/${productId}`))
      .set("X-CSRF-Token", csrfToken)
      .send({ category: "Other" });
    expect(categoryChange.status).toBe(409);
    expect(categoryChange.body.error.code).toBe("CLOTHING_CATEGORY_REQUIRED");

    const duplicate = await withOrigin(agent.post(`/api/clothing/products/${productId}/variants`))
      .set("X-CSRF-Token", csrfToken)
      .send({
        size: "m",
        colour: "NAVY BLUE",
        designIdentifier: "fw26",
        sku: "SHIRT-M-NAVY-2",
        stockQuantity: "1",
        lowStockThreshold: "0",
      });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("DUPLICATE_RESOURCE");

    const invalidThreshold = await withOrigin(agent.post(`/api/clothing/products/${productId}/variants`))
      .set("X-CSRF-Token", csrfToken)
      .send({
        size: "XL",
        colour: "Black",
        sku: "SHIRT-XL-BLACK",
        stockQuantity: "0",
        lowStockThreshold: "-1",
      });
    expect(invalidThreshold.status).toBe(400);

    const adjustment = await withOrigin(agent.post(`/api/clothing/variants/${navyVariant._id}/adjustments`))
      .set("X-CSRF-Token", csrfToken)
      .send({ quantityDelta: "-3", reason: "Damaged stock" });
    expect(adjustment.status).toBe(200);
    expect(adjustment.body.data.stockQuantity).toBe("5");
    const thresholdUpdate = await withOrigin(agent.patch(`/api/clothing/variants/${blueVariant._id}`))
      .set("X-CSRF-Token", csrfToken)
      .send({ lowStockThreshold: "3" });
    expect(thresholdUpdate.status).toBe(200);
    expect(thresholdUpdate.body.data.lowStockThreshold).toBe("3");
    const invalidThresholdUpdate = await withOrigin(agent.patch(`/api/clothing/variants/${blueVariant._id}`))
      .set("X-CSRF-Token", csrfToken)
      .send({ lowStockThreshold: "-1" });
    expect(invalidThresholdUpdate.status).toBe(400);
    const insufficient = await withOrigin(agent.post(`/api/clothing/variants/${navyVariant._id}/adjustments`))
      .set("X-CSRF-Token", csrfToken)
      .send({ quantityDelta: "-6", reason: "Invalid removal" });
    expect(insufficient.status).toBe(409);
    expect(insufficient.body.error.code).toBe("INSUFFICIENT_VARIANT_STOCK");
    expect(await StockMovementModel.countDocuments({ store: clothingStoreId, variant: navyVariant._id })).toBe(1);
    expect((await ClothingVariantModel.findById(blueVariant._id))?.stockQuantity.toString()).toBe("2");

    const secondClothingStoreId = await createStore(agent, csrfToken, "Second Clothing Shop", "clothing");
    const crossStoreRead = await agent.get(`/api/clothing/products/${productId}/variants`);
    expect(crossStoreRead.status).toBe(404);
    const crossStoreCreate = await withOrigin(agent.post(`/api/clothing/products/${productId}/variants`))
      .set("X-CSRF-Token", csrfToken)
      .send({ size: "S", colour: "Red", sku: "OTHER-STORE-S-RED" });
    expect(crossStoreCreate.status).toBe(404);
    expect(await ClothingVariantModel.countDocuments({ store: secondClothingStoreId })).toBe(0);

    const groceryStoreId = await createStore(agent, csrfToken, "Grocery Shop", "grocery");
    const groceryBlocked = await agent.get(`/api/clothing/products/${productId}/variants`);
    expect(groceryBlocked.status).toBe(403);
    expect(groceryBlocked.body.error.code).toBe("SHOP_TYPE_NOT_SUPPORTED");
    expect(await ProductModel.countDocuments({ store: groceryStoreId })).toBe(0);

    const unauthenticated = await request(app).get(`/api/clothing/products/${productId}/variants`);
    expect(unauthenticated.status).toBe(401);

    await selectStore(agent, csrfToken, clothingStoreId);
    await StockMovementModel.deleteMany({ store: clothingStoreId, product: productId });
    const deletion = await withOrigin(agent.delete(`/api/products/${productId}`))
      .set("X-CSRF-Token", csrfToken);
    expect(deletion.status).toBe(200);
    expect(deletion.body.data.action).toBe("deactivated");
    expect(await ClothingVariantModel.countDocuments({ store: clothingStoreId, product: productId })).toBe(2);
  });
});
