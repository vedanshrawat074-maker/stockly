import { Types } from "mongoose";
import { assertDevelopmentStoreTarget, ProvisioningTargetError } from "../config/development-store-provisioning";
import type { AppConfig } from "../config/env";
import { BatchModel } from "../models/batch";
import { ProductModel } from "../models/product";
import { SaleModel } from "../models/sale";
import { StoreMembershipModel } from "../models/store-membership";
import { StoreModel } from "../models/store";
import { UserModel } from "../models/user";
import { receiveBatch } from "../services/inventory-service";
import { createProduct } from "../services/product-service";
import { createSale } from "../services/sale-service";
import { objectIdSchema } from "../validators/common-validator";
import { receiveBatchSchema } from "../validators/inventory-validator";
import { createProductSchema } from "../validators/product-validator";
import { createSaleSchema } from "../validators/sale-validator";

const DEMO_PRODUCTS = [
  { code: "BASMATI-RICE", name: "Demo - Basmati Rice", category: "Demo Grocery", baseUnit: "kg", sellingPrice: "125", quantity: "40", unitCost: "88" },
  { code: "TOOR-DAL", name: "Demo - Toor Dal", category: "Demo Grocery", baseUnit: "kg", sellingPrice: "145", quantity: "30", unitCost: "105" },
  { code: "TEA-LEAVES", name: "Demo - Assam Tea", category: "Demo Grocery", baseUnit: "pack", sellingPrice: "95", quantity: "24", unitCost: "62" },
  { code: "COOKING-OIL", name: "Demo - Sunflower Oil", category: "Demo Grocery", baseUnit: "litre", sellingPrice: "160", quantity: "36", unitCost: "121" },
] as const;

const DEMO_SALES = [
  [{ code: "BASMATI-RICE", quantity: "1.5" }, { code: "TOOR-DAL", quantity: "0.75" }],
  [{ code: "TEA-LEAVES", quantity: "2" }, { code: "COOKING-OIL", quantity: "1" }],
  [{ code: "BASMATI-RICE", quantity: "2" }, { code: "COOKING-OIL", quantity: "1.5" }],
] as const;

const RECEIVED_DATE = "2026-10-01";
const EXPIRY_DATE = "2029-12-31";

export function assertDemoSeedTarget(
  config: Pick<AppConfig, "nodeEnv" | "mongodbUri">,
  storeId: string | undefined,
): Types.ObjectId {
  assertDevelopmentStoreTarget(config);
  const parsedStoreId = objectIdSchema.safeParse(storeId);
  if (!parsedStoreId.success) {
    throw new ProvisioningTargetError("Provide an explicit target store ID as a 24-character MongoDB ObjectId.");
  }
  return new Types.ObjectId(parsedStoreId.data);
}

export async function assertActiveStoreOwner(
  storeId: Types.ObjectId,
  userId: Types.ObjectId,
): Promise<void> {
  const [store, user, membership] = await Promise.all([
    StoreModel.exists({ _id: storeId }),
    UserModel.exists({ _id: userId, status: "active" }),
    StoreMembershipModel.exists({
      store: storeId,
      user: userId,
      role: "OWNER",
      status: "ACTIVE",
    }),
  ]);
  if (!store || !user || !membership) {
    throw new ProvisioningTargetError("The authenticated active user must have OWNER membership in the target store.");
  }
}

function getProductSeed(storeId: Types.ObjectId, product: (typeof DEMO_PRODUCTS)[number]) {
  const storeMarker = storeId.toHexString();
  return {
    name: product.name,
    sku: `DEMO-${storeMarker.toUpperCase()}-${product.code}`,
    category: product.category,
    baseUnit: product.baseUnit,
    sellingPrice: product.sellingPrice,
  };
}

function matchesProduct(
  existing: { name: string; sku: string; category: string; baseUnit: string; sellingPrice: Types.Decimal128 },
  expected: ReturnType<typeof getProductSeed>,
): boolean {
  return existing.name === expected.name &&
    existing.sku === expected.sku &&
    existing.category === expected.category &&
    existing.baseUnit === expected.baseUnit &&
    existing.sellingPrice.toString() === Types.Decimal128.fromString(expected.sellingPrice).toString();
}

export type DemoSeedResult = {
  productsCreated: number;
  productsReused: number;
  batchesReceived: number;
  batchesReused: number;
  salesCreated: number;
  salesReplayed: number;
};

export async function seedDemoDataForStore(
  storeId: Types.ObjectId,
  ownerUserId: Types.ObjectId,
): Promise<DemoSeedResult> {
  await assertActiveStoreOwner(storeId, ownerUserId);
  const result: DemoSeedResult = {
    productsCreated: 0,
    productsReused: 0,
    batchesReceived: 0,
    batchesReused: 0,
    salesCreated: 0,
    salesReplayed: 0,
  };
  const productsByCode = new Map<string, Types.ObjectId>();

  for (const productSeed of DEMO_PRODUCTS) {
    await assertActiveStoreOwner(storeId, ownerUserId);
    const expected = getProductSeed(storeId, productSeed);
    const existing = await ProductModel.findOne({ store: storeId, sku: expected.sku });
    if (existing) {
      if (!matchesProduct(existing, expected) || !existing.isActive) {
        throw new ProvisioningTargetError(`Existing demo SKU ${expected.sku} does not match the seed; refusing to modify it.`);
      }
      result.productsReused += 1;
      productsByCode.set(productSeed.code, existing._id);
      continue;
    }

    const input = createProductSchema.parse(expected);
    const created = await createProduct(storeId, input);
    result.productsCreated += 1;
    productsByCode.set(productSeed.code, created._id);
  }

  for (const productSeed of DEMO_PRODUCTS) {
    await assertActiveStoreOwner(storeId, ownerUserId);
    const productId = productsByCode.get(productSeed.code);
    if (!productId) throw new Error("Demo product was not resolved before batch receipt.");

    const batchNumber = `DEMO-V1-${storeId.toHexString()}-${productSeed.code}-BATCH-01`;
    const existing = await BatchModel.findOne({ store: storeId, product: productId, batchNumber });
    if (existing) {
      const expectedExpiry = new Date(`${EXPIRY_DATE}T00:00:00.000Z`).getTime();
      const matches = existing.receivedQuantity.toString() === Types.Decimal128.fromString(productSeed.quantity).toString() &&
        existing.unitCost.toString() === Types.Decimal128.fromString(productSeed.unitCost).toString() &&
        existing.receivedDate.getTime() === new Date(`${RECEIVED_DATE}T00:00:00.000Z`).getTime() &&
        existing.expiryDate?.getTime() === expectedExpiry;
      if (!matches) {
        throw new ProvisioningTargetError(`Existing demo batch ${batchNumber} differs from the seed; refusing to modify it.`);
      }
      result.batchesReused += 1;
      continue;
    }

    const input = receiveBatchSchema.parse({
      batchNumber,
      quantity: productSeed.quantity,
      unitCost: productSeed.unitCost,
      receivedDate: RECEIVED_DATE,
      expiryDate: EXPIRY_DATE,
    });
    await receiveBatch(storeId, productId, {
      ...input,
      idempotencyKey: `stockly-demo-v1-${storeId.toHexString()}-receipt-${productSeed.code}`,
    });
    result.batchesReceived += 1;
  }

  for (const [index, saleItems] of DEMO_SALES.entries()) {
    await assertActiveStoreOwner(storeId, ownerUserId);
    const input = createSaleSchema.parse({
      items: saleItems.map((item) => {
        const productId = productsByCode.get(item.code);
        if (!productId) throw new Error("Demo sale product was not resolved before sale creation.");
        return { productId: productId.toHexString(), quantity: item.quantity };
      }),
    });
    const idempotencyKey =
      `stockly-demo-v1-${storeId.toHexString()}-sale-${String(index + 1).padStart(2, "0")}`;
    const existingSale = await SaleModel.exists({ store: storeId, idempotencyKey });
    if (!existingSale) {
      const productIds = input.items.map((item) => new Types.ObjectId(item.productId));
      const nonDemoBatch = await BatchModel.exists({
        store: storeId,
        product: { $in: productIds },
        batchNumber: { $not: new RegExp(`^DEMO-V1-${storeId.toHexString()}-`) },
      });
      if (nonDemoBatch) {
        throw new ProvisioningTargetError(
          "A demo product has non-demo stock batches; refusing to let demo sales consume existing business inventory.",
        );
      }
    }
    const sale = await createSale(storeId, {
      ...input,
      idempotencyKey,
    });
    if (sale.replayed) result.salesReplayed += 1;
    else result.salesCreated += 1;
  }

  return result;
}
