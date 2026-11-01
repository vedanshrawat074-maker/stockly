import { Types } from "mongoose";
import { BatchModel } from "../models/batch";
import { InventoryModel } from "../models/inventory";
import { ProductModel } from "../models/product";
import { StoreModel } from "../models/store";
import { StockMovementModel } from "../models/stock-movement";
import { ApiError } from "../utils/api-error";
import { compareCalendarDates, getExpiryDateOnly, getStoreLocalDate } from "./expiry-calendar";
import { runInTransaction } from "./transaction-service";

export type ReceiveBatchInput = {
  batchNumber: string;
  quantity: string;
  unitCost: string;
  receivedDate?: string;
  expiryDate?: string;
  idempotencyKey?: string;
};

export async function listInventory(
  storeId: Types.ObjectId,
  page: number,
  limit: number,
) {
  const filter = { store: storeId };
  const [items, totalItems, totals] = await Promise.all([
    InventoryModel.find(filter)
      .sort({ product: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    InventoryModel.countDocuments(filter),
    BatchModel.aggregate<{ _id: Types.ObjectId; onHandQuantity: Types.Decimal128 }>([
      { $match: { store: storeId } },
      {
        $group: {
          _id: "$product",
          onHandQuantity: { $sum: "$remainingQuantity" },
        },
      },
    ]),
  ]);
  const totalByProduct = new Map(
    totals.map((item) => [item._id.toHexString(), item.onHandQuantity.toString()]),
  );

  return {
    data: items.map((item) => ({
      ...item,
      onHandQuantity: totalByProduct.get(item.product.toHexString()) ?? "0",
    })),
    pagination: {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
    },
  };
}

export async function getInventoryForProduct(
  storeId: Types.ObjectId,
  productId: Types.ObjectId,
) {
  const product = await ProductModel.findOne({ _id: productId, store: storeId }).lean();
  if (!product) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product was not found.");

  const [inventory, totals] = await Promise.all([
    InventoryModel.findOne({ store: storeId, product: productId }).lean(),
    BatchModel.aggregate<{ onHandQuantity: Types.Decimal128 }>([
      { $match: { store: storeId, product: productId } },
      {
        $group: {
          _id: null,
          onHandQuantity: { $sum: "$remainingQuantity" },
        },
      },
    ]),
  ]);

  return {
    inventory,
    product,
    onHandQuantity: totals[0]?.onHandQuantity.toString() ?? "0",
  };
}

export async function receiveBatch(
  storeId: Types.ObjectId,
  productId: Types.ObjectId,
  input: ReceiveBatchInput,
) {
  return runInTransaction(async (session) => {
    const product = await ProductModel.findOne({
      _id: productId,
      store: storeId,
      isActive: true,
    })
      .session(session)
      .lean();

    if (!product) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Active product was not found in this store.");

    const receivedDate = input.receivedDate ? new Date(input.receivedDate) : new Date();
    const expiryDate = input.expiryDate
      ? new Date(`${input.expiryDate.slice(0, 10)}T00:00:00.000Z`)
      : undefined;
    if (expiryDate) {
      const store = await StoreModel.findById(storeId).session(session).lean();
      if (!store) throw new ApiError(404, "STORE_NOT_FOUND", "Store was not found.");
      const receivedLocalDate = getStoreLocalDate(receivedDate, store.timezone);
      if (compareCalendarDates(getExpiryDateOnly(expiryDate), receivedLocalDate) < 0) {
        throw new ApiError(
          400,
          "INVALID_EXPIRY_DATE",
          "Expiry date must be on or after the received date in the store timezone.",
        );
      }
    }
    const inventory = await InventoryModel.findOneAndUpdate(
      { store: storeId, product: productId },
      {
        $setOnInsert: {
          store: storeId,
          product: productId,
          minimumStockThreshold: Types.Decimal128.fromString("0"),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, session },
    );
    const [batch] = await BatchModel.create(
      [
        {
          store: storeId,
          product: productId,
          batchNumber: input.batchNumber,
          receivedQuantity: Types.Decimal128.fromString(input.quantity),
          remainingQuantity: Types.Decimal128.fromString(input.quantity),
          unitCost: Types.Decimal128.fromString(input.unitCost),
          receivedDate,
          ...(expiryDate ? { expiryDate } : {}),
        },
      ],
      { session },
    );
    const [movement] = await StockMovementModel.create(
      [
        {
          store: storeId,
          product: productId,
          batch: batch._id,
          movementType: "receipt",
          quantityDelta: Types.Decimal128.fromString(input.quantity),
          reason: `Batch received: ${input.batchNumber}`,
          ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        },
      ],
      { session },
    );

    return { inventory, batch, movement };
  });
}

export async function listBatches(
  storeId: Types.ObjectId,
  productId: Types.ObjectId,
  page: number,
  limit: number,
) {
  const product = await ProductModel.findOne({ _id: productId, store: storeId }).select("_id").lean();
  if (!product) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product was not found.");

  const filter = { store: storeId, product: productId };
  const [data, totalItems] = await Promise.all([
    BatchModel.find(filter)
      .sort({ expiryDate: 1, receivedDate: -1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    BatchModel.countDocuments(filter),
  ]);

  return {
    data,
    pagination: {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
    },
  };
}
