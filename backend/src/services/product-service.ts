import { Types } from "mongoose";
import { ProductModel } from "../models/product";
import { InventoryModel } from "../models/inventory";
import { BatchModel } from "../models/batch";
import { StockMovementModel } from "../models/stock-movement";
import { ApiError } from "../utils/api-error";
import { runInTransaction } from "./transaction-service";

export type ProductInput = {
  name: string;
  sku: string;
  barcode?: string;
  category: string;
  baseUnit: string;
  sellingPrice: string;
};

export type ProductQuery = {
  page: number;
  limit: number;
  search?: string;
  category?: string;
  isActive?: boolean;
};

export async function createProduct(storeId: Types.ObjectId, input: ProductInput) {
  return ProductModel.create({
    ...input,
    store: storeId,
    sellingPrice: Types.Decimal128.fromString(input.sellingPrice),
    isActive: true,
  });
}

export async function listProducts(storeId: Types.ObjectId, query: ProductQuery) {
  const filter: Record<string, unknown> = { store: storeId };
  if (query.category !== undefined) filter.category = query.category;
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.search) {
    const escapedSearch = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { name: { $regex: escapedSearch, $options: "i" } },
      { sku: { $regex: escapedSearch, $options: "i" } },
      { barcode: { $regex: escapedSearch, $options: "i" } },
    ];
  }

  const [data, totalItems] = await Promise.all([
    ProductModel.find(filter)
      .sort({ name: 1, _id: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    ProductModel.countDocuments(filter),
  ]);

  return {
    data,
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    },
  };
}

export async function getProduct(storeId: Types.ObjectId, productId: Types.ObjectId) {
  const product = await ProductModel.findOne({ _id: productId, store: storeId }).lean();
  if (!product) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product was not found.");
  return product;
}

export async function updateProduct(
  storeId: Types.ObjectId,
  productId: Types.ObjectId,
  input: Partial<ProductInput>,
) {
  const update = {
    ...input,
    ...(input.sellingPrice === undefined
      ? {}
      : { sellingPrice: Types.Decimal128.fromString(input.sellingPrice) }),
  };
  const product = await ProductModel.findOneAndUpdate(
    { _id: productId, store: storeId },
    { $set: update },
    { new: true, runValidators: true },
  ).lean();

  if (!product) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product was not found.");
  return product;
}

export async function deleteProduct(storeId: Types.ObjectId, productId: Types.ObjectId) {
  return runInTransaction(async (session) => {
    const product = await ProductModel.findOne({ _id: productId, store: storeId }).session(session);
    if (!product) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product was not found.");

    const referenceFilter = { store: storeId, product: productId };
    const inventoryReference = await InventoryModel.exists(referenceFilter).session(session);
    const batchReference = inventoryReference
      ? null
      : await BatchModel.exists(referenceFilter).session(session);
    const movementReference =
      inventoryReference || batchReference
        ? null
        : await StockMovementModel.exists(referenceFilter).session(session);

    if (inventoryReference || batchReference || movementReference) {
      product.isActive = false;
      await product.save({ session });
      return { id: productId.toHexString(), action: "deactivated" as const };
    }

    await product.deleteOne({ session });
    return { id: productId.toHexString(), action: "deleted" as const };
  });
}
