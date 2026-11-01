import { createHash, randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { BatchModel } from "../models/batch";
import { ProductModel } from "../models/product";
import { SaleModel } from "../models/sale";
import { StockMovementModel } from "../models/stock-movement";
import {
  addDecimals,
  compareDecimals,
  multiplyDecimals,
  negateDecimal,
} from "../utils/decimal-arithmetic";
import { ApiError } from "../utils/api-error";
import { planFefoAllocations } from "./fefo-allocation";
import { runInTransaction } from "./transaction-service";

export type CreateSaleInput = {
  items: Array<{ productId: string; quantity: string }>;
  idempotencyKey: string;
};

export type SalesListQuery = {
  page: number;
  limit: number;
};

type SaleAllocation = {
  batch: Types.ObjectId;
  quantity: Types.Decimal128;
};

type BuiltSaleLine = {
  product: Types.ObjectId;
  quantity: Types.Decimal128;
  unitPrice: Types.Decimal128;
  lineTotal: Types.Decimal128;
  allocations: SaleAllocation[];
};

type SaleResult = {
  sale: InstanceType<typeof SaleModel>;
  replayed: boolean;
};

function getRequestHash(input: CreateSaleInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        items: input.items.map((item) => ({
          productId: item.productId.toLowerCase(),
          quantity: Types.Decimal128.fromString(item.quantity).toString(),
        })),
      }),
    )
    .digest("hex");
}

function assertSameRequest(
  sale: InstanceType<typeof SaleModel>,
  requestHash: string,
): void {
  if (sale.requestHash !== requestHash) {
    throw new ApiError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "This idempotency key was already used for a different sale request.",
    );
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function newInsufficientStockError(productId: Types.ObjectId): ApiError {
  return new ApiError(
    409,
    "INSUFFICIENT_STOCK",
    `Insufficient unexpired stock for product ${productId.toHexString()}.`,
  );
}

async function createSaleInTransaction(
  storeId: Types.ObjectId,
  input: CreateSaleInput,
  requestHash: string,
): Promise<SaleResult> {
  return runInTransaction(async (session) => {
    const priorSale = await SaleModel.findOne({
      store: storeId,
      idempotencyKey: input.idempotencyKey,
    })
      .session(session)
      .exec();
    if (priorSale) {
      assertSameRequest(priorSale, requestHash);
      return { sale: priorSale, replayed: true };
    }

    const productIds = input.items.map((item) => new Types.ObjectId(item.productId));
    const products = await ProductModel.find({
      _id: { $in: productIds },
      store: storeId,
      isActive: true,
    })
      .session(session)
      .exec();
    const productsById = new Map(products.map((product) => [product._id.toHexString(), product]));

    for (const productId of productIds) {
      if (!productsById.has(productId.toHexString())) {
        throw new ApiError(
          404,
          "PRODUCT_NOT_FOUND",
          `Active product ${productId.toHexString()} was not found in this store.`,
        );
      }
    }

    const saleIdentifier = randomUUID();
    const saleLines: BuiltSaleLine[] = [];
    let totalAmount = Types.Decimal128.fromString("0");

    for (const item of input.items) {
      const productId = new Types.ObjectId(item.productId);
      const product = productsById.get(productId.toHexString());
      if (!product) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product was not found.");

      const requestedQuantity = Types.Decimal128.fromString(item.quantity);
      const now = new Date();
      const batches = await BatchModel.find({
        store: storeId,
        product: productId,
        remainingQuantity: { $gt: Types.Decimal128.fromString("0") },
        $or: [{ expiryDate: { $gt: now } }, { expiryDate: { $exists: false } }],
      })
        .session(session)
        .exec();
      const plan = planFefoAllocations(batches, requestedQuantity, now);
      if (compareDecimals(plan.outstanding, "0") > 0) {
        throw newInsufficientStockError(productId);
      }

      const allocations: SaleAllocation[] = [];
      for (const planned of plan.allocations) {
        const batch = planned.batch;
        const allocation = planned.quantity;
        const updatedBatch = await BatchModel.findOneAndUpdate(
          {
            _id: batch._id,
            store: storeId,
            product: productId,
            remainingQuantity: { $gte: allocation },
          },
          { $inc: { remainingQuantity: negateDecimal(allocation) } },
          { new: true, session },
        ).exec();

        if (!updatedBatch) {
          throw new ApiError(
            409,
            "STOCK_CHANGED",
            "Stock changed while the sale was being processed. Retry the request.",
          );
        }

        allocations.push({ batch: batch._id, quantity: allocation });
      }

      const unitPrice = product.sellingPrice;
      const lineTotal = multiplyDecimals(item.quantity, unitPrice);
      totalAmount = addDecimals(totalAmount, lineTotal);
      saleLines.push({
        product: productId,
        quantity: requestedQuantity,
        unitPrice,
        lineTotal,
        allocations,
      });
    }

    const [sale] = await SaleModel.create(
      [
        {
          store: storeId,
          saleIdentifier,
          lineItems: saleLines,
          totalAmount,
          status: "completed",
          idempotencyKey: input.idempotencyKey,
          requestHash,
        },
      ],
      { session },
    );

    const movementDocuments = saleLines.flatMap((line, lineIndex) =>
      line.allocations.map((allocation, allocationIndex) => ({
        store: storeId,
        product: line.product,
        batch: allocation.batch,
        sale: sale._id,
        movementType: "sale" as const,
        quantityDelta: negateDecimal(allocation.quantity),
        reason: `Sale ${saleIdentifier}`,
        idempotencyKey: `${saleIdentifier}:${lineIndex}:${allocationIndex}`,
      })),
    );
    if (movementDocuments.length > 0) {
      await StockMovementModel.insertMany(movementDocuments, { session });
    }

    return { sale, replayed: false };
  });
}

export async function createSale(
  storeId: Types.ObjectId,
  input: CreateSaleInput,
): Promise<SaleResult> {
  const requestHash = getRequestHash(input);
  const existing = await SaleModel.findOne({
    store: storeId,
    idempotencyKey: input.idempotencyKey,
  }).exec();
  if (existing) {
    assertSameRequest(existing, requestHash);
    return { sale: existing, replayed: true };
  }

  try {
    return await createSaleInTransaction(storeId, input, requestHash);
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

    const sale = await SaleModel.findOne({
      store: storeId,
      idempotencyKey: input.idempotencyKey,
    }).exec();
    if (sale) {
      assertSameRequest(sale, requestHash);
      return { sale, replayed: true };
    }
    throw error;
  }
}

export async function listSales(
  storeId: Types.ObjectId,
  query: SalesListQuery,
) {
  const filter = { store: storeId };
  const [data, totalItems] = await Promise.all([
    SaleModel.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    SaleModel.countDocuments(filter),
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
