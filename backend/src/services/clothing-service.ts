import { Types, type ClientSession } from "mongoose";
import { ClothingVariantModel } from "../models/clothing-variant";
import { ProductModel } from "../models/product";
import { StockMovementModel } from "../models/stock-movement";
import { clothingCategories } from "../validators/clothing-validator";
import { ApiError } from "../utils/api-error";
import { compareDecimals, negateDecimal } from "../utils/decimal-arithmetic";
import { runInTransaction } from "./transaction-service";
import { reconcileClothingVariantAlertInTransaction } from "./alert-generation-service";

type ClothingProductInput = {
  name: string;
  sku: string;
  barcode?: string;
  category: (typeof clothingCategories)[number];
  sellingPrice: string;
  variants: ClothingVariantInput[];
};

export type ClothingVariantInput = {
  size: string;
  colour: string;
  designIdentifier?: string;
  sku: string;
  stockQuantity: string;
  lowStockThreshold: string;
};

function normalizedVariant(input: ClothingVariantInput) {
  return {
    size: input.size.trim().toUpperCase(),
    colour: input.colour.trim().toLowerCase(),
    ...(input.designIdentifier
      ? { designIdentifier: input.designIdentifier.trim().toUpperCase() }
      : {}),
    sku: input.sku.trim().toUpperCase(),
    stockQuantity: Types.Decimal128.fromString(input.stockQuantity),
    lowStockThreshold: Types.Decimal128.fromString(input.lowStockThreshold),
  };
}

async function assertClothingProduct(
  storeId: Types.ObjectId,
  productId: Types.ObjectId,
  session?: ClientSession,
) {
  const query = ProductModel.findOne({ _id: productId, store: storeId }).select({
    _id: 1,
    category: 1,
  });
  if (session) query.session(session);
  const product = await query.lean();

  if (!product) {
    throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product was not found.");
  }
  if (!clothingCategories.some((category) => category === product.category)) {
    throw new ApiError(
      409,
      "CLOTHING_PRODUCT_REQUIRED",
      "Variants can only be managed for a product in a clothing category.",
    );
  }
}

export async function createClothingProduct(storeId: Types.ObjectId, input: ClothingProductInput) {
  return runInTransaction(async (session) => {
    const [product] = await ProductModel.create(
      [{
        store: storeId,
        name: input.name,
        sku: input.sku,
        ...(input.barcode ? { barcode: input.barcode } : {}),
        category: input.category,
        baseUnit: "piece",
        sellingPrice: Types.Decimal128.fromString(input.sellingPrice),
        isActive: true,
      }],
      { session },
    );
    const variants = input.variants.length
      ? await ClothingVariantModel.create(
          input.variants.map((variant) => ({
            store: storeId,
            product: product._id,
            ...normalizedVariant(variant),
          })),
          { session, ordered: true },
        )
      : [];
    for (const variant of variants) {
        await reconcileClothingVariantAlertInTransaction(storeId, variant._id, session);
    }
    return { product, variants };
  });
}

export async function createClothingVariant(
  storeId: Types.ObjectId,
  productId: Types.ObjectId,
  input: ClothingVariantInput,
) {
  return runInTransaction(async (session) => {
    await assertClothingProduct(storeId, productId, session);
    const product = await ProductModel.findOneAndUpdate(
      { _id: productId, store: storeId },
      { $inc: { clothingVariantRevision: 1 } },
      { new: true, session },
    ).select({ _id: 1 }).lean();
    if (!product) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product was not found.");

    const [variant] = await ClothingVariantModel.create(
      [{
        store: storeId,
        product: productId,
        ...normalizedVariant(input),
      }],
      { session },
    );
    await reconcileClothingVariantAlertInTransaction(storeId, variant._id, session);
    return variant;
  });
}

export async function listClothingVariants(storeId: Types.ObjectId, productId: Types.ObjectId) {
  await assertClothingProduct(storeId, productId);
  return ClothingVariantModel.find({ store: storeId, product: productId })
    .sort({ size: 1, colour: 1, designIdentifier: 1, _id: 1 })
    .lean();
}

export async function updateClothingVariant(
  storeId: Types.ObjectId,
  variantId: Types.ObjectId,
  input: Partial<ClothingVariantInput>,
) {
  const update = {
    ...(input.size === undefined ? {} : { size: input.size.trim().toUpperCase() }),
    ...(input.colour === undefined ? {} : { colour: input.colour.trim().toLowerCase() }),
    ...(input.designIdentifier === undefined
      ? {}
      : { designIdentifier: input.designIdentifier.trim().toUpperCase() }),
    ...(input.sku === undefined ? {} : { sku: input.sku.trim().toUpperCase() }),
    ...(input.lowStockThreshold === undefined
      ? {}
      : { lowStockThreshold: Types.Decimal128.fromString(input.lowStockThreshold) }),
  };
  return runInTransaction(async (session) => {
    const existing = await ClothingVariantModel.findOne({ _id: variantId, store: storeId })
      .select({ product: 1 })
      .session(session)
      .lean();
    if (!existing) throw new ApiError(404, "VARIANT_NOT_FOUND", "Clothing variant was not found.");
    await assertClothingProduct(storeId, existing.product, session);

    const variant = await ClothingVariantModel.findOneAndUpdate(
      { _id: variantId, store: storeId },
      { $set: update },
      { new: true, runValidators: true, session },
    ).lean();

    if (!variant) throw new ApiError(404, "VARIANT_NOT_FOUND", "Clothing variant was not found.");
    await reconcileClothingVariantAlertInTransaction(storeId, variantId, session);
    return variant;
  });
}

export async function adjustClothingVariantStock(
  storeId: Types.ObjectId,
  variantId: Types.ObjectId,
  quantityDelta: string,
  reason: string,
) {
  const adjustment = Types.Decimal128.fromString(quantityDelta);
  const reducingStock = compareDecimals(adjustment, "0") < 0;
  return runInTransaction(async (session) => {
    const current = await ClothingVariantModel.findOne({ _id: variantId, store: storeId })
      .select({ product: 1 })
      .session(session)
      .lean();
    if (!current) throw new ApiError(404, "VARIANT_NOT_FOUND", "Clothing variant was not found.");
    await assertClothingProduct(storeId, current.product);

    const variant = await ClothingVariantModel.findOneAndUpdate(
      {
        _id: variantId,
        store: storeId,
        ...(reducingStock ? { stockQuantity: { $gte: negateDecimal(adjustment) } } : {}),
      },
      { $inc: { stockQuantity: adjustment } },
      { new: true, session },
    ).lean();
    if (!variant) {
      throw new ApiError(409, "INSUFFICIENT_VARIANT_STOCK", "Stock cannot be adjusted below zero.");
    }

    await StockMovementModel.create(
      [{
        store: storeId,
        product: current.product,
        variant: variantId,
        movementType: "adjustment",
        quantityDelta: adjustment,
        reason,
        timestamp: new Date(),
      }],
      { session },
    );
    await reconcileClothingVariantAlertInTransaction(storeId, variantId, session);
    return variant;
  });
}
