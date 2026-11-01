import "dotenv/config";
import mongoose, { Types } from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BatchModel } from "../../src/models/batch";
import { InventoryModel } from "../../src/models/inventory";
import { ProductModel } from "../../src/models/product";
import { SaleModel } from "../../src/models/sale";
import { StockMovementModel } from "../../src/models/stock-movement";
import { StoreMembershipModel } from "../../src/models/store-membership";
import { StoreModel } from "../../src/models/store";
import { UserModel } from "../../src/models/user";
import { assertActiveStoreOwner, seedDemoDataForStore } from "../../src/scripts/demo-seed-data";
import { registerUser } from "../../src/services/auth-service";
import { createProduct } from "../../src/services/product-service";
import { receiveBatch } from "../../src/services/inventory-service";
import { createSale } from "../../src/services/sale-service";

const TEST_DATABASE = "stockly_test";
const ownedStores: Types.ObjectId[] = [];
const ownedUsers: Types.ObjectId[] = [];

function getTestUri(): string {
  const uri = process.env.MONGODB_TEST_URI;
  const sourceUri = uri ?? process.env.MONGODB_URI;
  if (!sourceUri) throw new Error("Set MONGODB_TEST_URI or MONGODB_URI for integration tests.");

  const parsed = new URL(sourceUri);
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (uri && database !== TEST_DATABASE) {
    throw new Error(`MONGODB_TEST_URI must target only ${TEST_DATABASE}.`);
  }
  if (!uri && database !== "stockly" && database !== TEST_DATABASE) {
    throw new Error("MONGODB_URI must target stockly or stockly_test before deriving the test URI.");
  }
  if (!uri) parsed.pathname = `/${TEST_DATABASE}`;

  const hosts = parsed.host.split(",").map((host) =>
    host.slice(host.lastIndexOf("@") + 1).split(":")[0].replace(/^\[|\]$/g, "").toLowerCase(),
  );
  if (hosts.length !== 1 || hosts.some((host) => !["localhost", "127.0.0.1", "::1"].includes(host))) {
    throw new Error("Demo seeder integration tests require a local MongoDB host.");
  }
  if (parsed.searchParams.get("replicaSet") !== "rs0") {
    throw new Error("Demo seeder integration tests require replicaSet=rs0.");
  }
  return parsed.toString();
}

async function storeSnapshot(storeId: Types.ObjectId) {
  const [products, batches, inventory, sales, movements] = await Promise.all([
    ProductModel.find({ store: storeId }).sort({ _id: 1 }).lean(),
    BatchModel.find({ store: storeId }).sort({ _id: 1 }).lean(),
    InventoryModel.find({ store: storeId }).sort({ _id: 1 }).lean(),
    SaleModel.find({ store: storeId }).sort({ _id: 1 }).lean(),
    StockMovementModel.find({ store: storeId }).sort({ _id: 1 }).lean(),
  ]);
  return JSON.stringify({ products, batches, inventory, sales, movements });
}

describe("demo data seeder on local test MongoDB", () => {
  let targetStoreId: Types.ObjectId;
  let otherStoreId: Types.ObjectId;
  let ownerUserId: Types.ObjectId;
  let nonOwnerUserId: Types.ObjectId;

  beforeAll(async () => {
    await mongoose.connect(getTestUri(), { serverSelectionTimeoutMS: 5_000 });
    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    if (
      mongoose.connection.db!.databaseName !== TEST_DATABASE ||
      hello.setName !== "rs0" ||
      hello.isWritablePrimary !== true ||
      hello.msg === "isdbgrid"
    ) {
      await mongoose.disconnect();
      throw new Error("Refusing seeder integration tests outside writable local stockly_test rs0.");
    }

    const targetStore = await StoreModel.create({
      name: "Seeder integration target",
      address: "Test-only target",
      timezone: "Asia/Kolkata",
      currency: "INR",
    });
    targetStoreId = targetStore._id;
    ownedStores.push(targetStoreId);

    const unrelatedStore = await StoreModel.create({
      name: "Unrelated integration store",
      address: "Test-only unrelated",
      timezone: "Asia/Kolkata",
      currency: "INR",
    });
    otherStoreId = unrelatedStore._id;
    ownedStores.push(otherStoreId);

    const owner = await registerUser({
      name: "Seeder owner",
      email: `demo-owner-${new Types.ObjectId().toHexString()}@example.test`,
      password: "integration-password-one",
    });
    ownerUserId = new Types.ObjectId(owner.id);
    ownedUsers.push(ownerUserId);
    await StoreMembershipModel.create({
      user: ownerUserId,
      store: targetStoreId,
      role: "OWNER",
      status: "ACTIVE",
    });

    const nonOwner = await registerUser({
      name: "Seeder non-owner",
      email: `demo-staff-${new Types.ObjectId().toHexString()}@example.test`,
      password: "integration-password-two",
    });
    nonOwnerUserId = new Types.ObjectId(nonOwner.id);
    ownedUsers.push(nonOwnerUserId);
    await StoreMembershipModel.create({
      user: nonOwnerUserId,
      store: targetStoreId,
      role: "STAFF",
      status: "ACTIVE",
    });

    const unrelatedProduct = await createProduct(otherStoreId, {
      name: "Unrelated store product",
      sku: `OTHER-${new Types.ObjectId().toHexString()}`,
      category: "Grocery",
      baseUnit: "kg",
      sellingPrice: "10",
    });
    await receiveBatch(otherStoreId, unrelatedProduct._id, {
      batchNumber: "OTHER-BATCH-01",
      quantity: "5",
      unitCost: "7",
      receivedDate: "2026-10-01",
      expiryDate: "2029-12-31",
    });
    await createSale(otherStoreId, {
      items: [{ productId: unrelatedProduct._id.toHexString(), quantity: "1" }],
      idempotencyKey: `unrelated-${new Types.ObjectId().toHexString()}`,
    });
  });

  afterAll(async () => {
    if (ownedStores.length > 0) {
      await Promise.all([
        BatchModel.deleteMany({ store: { $in: ownedStores } }),
        InventoryModel.deleteMany({ store: { $in: ownedStores } }),
        ProductModel.deleteMany({ store: { $in: ownedStores } }),
        SaleModel.deleteMany({ store: { $in: ownedStores } }),
        StockMovementModel.deleteMany({ store: { $in: ownedStores } }),
        StoreMembershipModel.deleteMany({ store: { $in: ownedStores } }),
      ]);
      await StoreModel.deleteMany({ _id: { $in: ownedStores } });
    }
    if (ownedUsers.length > 0) {
      await UserModel.deleteMany({ _id: { $in: ownedUsers } });
    }
    await mongoose.disconnect();
  });

  it("requires active OWNER membership before creating any demo records", async () => {
    await expect(seedDemoDataForStore(targetStoreId, nonOwnerUserId)).rejects.toThrow(/OWNER membership/);
    const [products, batches, inventory, sales, movements] = await Promise.all([
      ProductModel.countDocuments({ store: targetStoreId }),
      BatchModel.countDocuments({ store: targetStoreId }),
      InventoryModel.countDocuments({ store: targetStoreId }),
      SaleModel.countDocuments({ store: targetStoreId }),
      StockMovementModel.countDocuments({ store: targetStoreId }),
    ]);
    expect([products, batches, inventory, sales, movements]).toEqual([0, 0, 0, 0, 0]);
  });

  it("refuses to overwrite a conflicting record with a deterministic demo SKU", async () => {
    const conflictingProduct = await ProductModel.create({
      store: targetStoreId,
      name: "Existing business product",
      sku: `DEMO-${targetStoreId.toHexString().toUpperCase()}-BASMATI-RICE`,
      category: "Grocery",
      baseUnit: "kg",
      sellingPrice: Types.Decimal128.fromString("111"),
      isActive: true,
    });

    await expect(seedDemoDataForStore(targetStoreId, ownerUserId)).rejects.toThrow(/refusing to modify it/);
    const unchanged = await ProductModel.findById(conflictingProduct._id);
    expect(unchanged?.name).toBe("Existing business product");
    expect(unchanged?.sellingPrice.toString()).toBe("111");
    expect(await BatchModel.countDocuments({ store: targetStoreId })).toBe(0);
    expect(await SaleModel.countDocuments({ store: targetStoreId })).toBe(0);
    await conflictingProduct.deleteOne();
  });

  it("creates only target-store demo records and is idempotent without changing another store", async () => {
    const otherStoreBefore = await storeSnapshot(otherStoreId);

    const firstRun = await seedDemoDataForStore(targetStoreId, ownerUserId);
    expect(firstRun).toEqual({
      productsCreated: 4,
      productsReused: 0,
      batchesReceived: 4,
      batchesReused: 0,
      salesCreated: 3,
      salesReplayed: 0,
    });

    const targetProducts = await ProductModel.find({ store: targetStoreId });
    const targetBatches = await BatchModel.find({ store: targetStoreId });
    const targetSales = await SaleModel.find({ store: targetStoreId });
    expect(targetProducts).toHaveLength(4);
    expect(targetProducts.every((product) =>
      product.name.startsWith("Demo -") && product.sku.includes(targetStoreId.toHexString().toUpperCase()),
    )).toBe(true);
    expect(targetBatches).toHaveLength(4);
    expect(targetSales).toHaveLength(3);
    expect(targetSales.every((sale) => sale.status === "completed" && sale.lineItems.every((item) =>
      targetProducts.some((product) => product._id.equals(item.product)),
    ))).toBe(true);

    const afterFirstRun = await storeSnapshot(targetStoreId);
    const secondRun = await seedDemoDataForStore(targetStoreId, ownerUserId);
    expect(secondRun).toEqual({
      productsCreated: 0,
      productsReused: 4,
      batchesReceived: 0,
      batchesReused: 4,
      salesCreated: 0,
      salesReplayed: 3,
    });
    expect(await storeSnapshot(targetStoreId)).toBe(afterFirstRun);
    expect(await storeSnapshot(otherStoreId)).toBe(otherStoreBefore);
  });
});
