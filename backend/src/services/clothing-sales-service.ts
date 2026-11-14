import { createHash, randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { ClothingExchangeModel } from "../models/clothing-exchange";
import { ClothingReturnModel, type ClothingReturnLine } from "../models/clothing-return";
import { ClothingVariantModel } from "../models/clothing-variant";
import { ProductModel } from "../models/product";
import { SaleModel, type PaymentMethod, type SaleLineItem } from "../models/sale";
import { StockMovementModel } from "../models/stock-movement";
import { ApiError } from "../utils/api-error";
import {
  addDecimals,
  compareDecimals,
  multiplyDecimals,
  negateDecimal,
  subtractDecimals,
} from "../utils/decimal-arithmetic";
import { clothingCategories } from "../validators/clothing-validator";
import { runInTransaction } from "./transaction-service";
import { reconcileClothingVariantAlertInTransaction } from "./alert-generation-service";

type ClothingSaleLineInput = {
  variantId: string;
  quantity: string;
  unitPrice?: string;
  discountPerUnit?: string;
};

type IdempotentInput = { idempotencyKey: string };

export type CreateClothingSaleInput = IdempotentInput & {
  items: ClothingSaleLineInput[];
  paymentMethod: PaymentMethod;
};

export type ClothingReturnLineInput = {
  saleLineIndex: number;
  quantity: string;
  condition: "saleable" | "damaged";
  reason: string;
};

export type CreateClothingReturnInput = IdempotentInput & {
  saleId: string;
  items: ClothingReturnLineInput[];
  refundPaymentMethod: PaymentMethod;
};

export type CreateClothingExchangeInput = IdempotentInput & {
  saleId: string;
  returnedItems: ClothingReturnLineInput[];
  replacementItems: ClothingSaleLineInput[];
  paymentMethod?: PaymentMethod;
  refundPaymentMethod?: PaymentMethod;
};

export type ClothingTransactionListQuery = {
  page: number;
  limit: number;
  saleId?: string;
};

type TransactionResult<T> = { record: T; replayed: boolean };
type ReturnPreparation = { lineItems: ClothingReturnLine[]; returnedValue: Types.Decimal128 };

function hashRequest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertSameRequest(record: { requestHash: string }, requestHash: string): void {
  if (record.requestHash !== requestHash) {
    throw new ApiError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "This idempotency key was already used for a different request.",
    );
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error &&
    (error as { code?: unknown }).code === 11000;
}

function decimal(value: string): Types.Decimal128 {
  return Types.Decimal128.fromString(value);
}

function clothingVariantSnapshot(variant: {
  _id: Types.ObjectId;
  product: Types.ObjectId;
  sku: string;
  size: string;
  colour: string;
  designIdentifier?: string;
}) {
  return {
    variant: variant._id,
    variantSku: variant.sku,
    size: variant.size,
    colour: variant.colour,
    ...(variant.designIdentifier ? { designIdentifier: variant.designIdentifier } : {}),
  };
}

async function findSaleReplay(storeId: Types.ObjectId, key: string, requestHash: string) {
  const record = await SaleModel.findOne({
    store: storeId,
    businessType: "clothing",
    idempotencyKey: key,
  }).exec();
  if (!record) return null;
  assertSameRequest(record, requestHash);
  return record;
}

async function createClothingSaleInTransaction(
  storeId: Types.ObjectId,
  input: CreateClothingSaleInput,
  requestHash: string,
) {
  return runInTransaction(async (session) => {
    const prior = await SaleModel.findOne({
      store: storeId,
      businessType: "clothing",
      idempotencyKey: input.idempotencyKey,
    }).session(session).exec();
    if (prior) {
      assertSameRequest(prior, requestHash);
      return { record: prior, replayed: true };
    }

    const variantIds = input.items.map((item) => new Types.ObjectId(item.variantId));
    const variants = await ClothingVariantModel.find({
      store: storeId,
      _id: { $in: variantIds },
    }).session(session).exec();
    const variantsById = new Map(variants.map((variant) => [variant._id.toHexString(), variant]));
    const productIds = [...new Set(variants.map((variant) => variant.product.toHexString()))]
      .map((productId) => new Types.ObjectId(productId));
    const products = await ProductModel.find({
      store: storeId,
      _id: { $in: productIds },
      isActive: true,
    }).session(session).exec();
    const productsById = new Map(products.map((product) => [product._id.toHexString(), product]));

    let subtotal = decimal("0");
    let discountAmount = decimal("0");
    let totalAmount = decimal("0");
    const lineItems: SaleLineItem[] = [];
    const stockMovements = [];

    for (const [index, item] of input.items.entries()) {
      const variantId = new Types.ObjectId(item.variantId);
      const variant = variantsById.get(variantId.toHexString());
      if (!variant) {
        throw new ApiError(404, "VARIANT_NOT_FOUND", "A clothing variant was not found in this store.");
      }
      const product = productsById.get(variant.product.toHexString());
      if (!product || !clothingCategories.some((category) => category === product.category)) {
        throw new ApiError(404, "PRODUCT_NOT_FOUND", "An active clothing product was not found in this store.");
      }

      const quantity = decimal(item.quantity);
      const unitPrice = item.unitPrice === undefined ? product.sellingPrice : decimal(item.unitPrice);
      const perUnitDiscount = item.discountPerUnit === undefined ? decimal("0") : decimal(item.discountPerUnit);
      if (compareDecimals(perUnitDiscount, unitPrice) > 0) {
        throw new ApiError(400, "INVALID_DISCOUNT", "A per-item discount cannot exceed its unit price.");
      }
      const netUnitPrice = subtractDecimals(unitPrice, perUnitDiscount);
      const lineSubtotal = multiplyDecimals(quantity, unitPrice);
      const lineDiscount = multiplyDecimals(quantity, perUnitDiscount);
      const lineTotal = multiplyDecimals(quantity, netUnitPrice);

      const updatedVariant = await ClothingVariantModel.findOneAndUpdate(
        {
          _id: variantId,
          store: storeId,
          stockQuantity: { $gte: quantity },
        },
        { $inc: { stockQuantity: negateDecimal(quantity) } },
        { new: true, session },
      ).session(session).exec();
      if (!updatedVariant) {
        throw new ApiError(
          409,
          "INSUFFICIENT_VARIANT_STOCK",
          `Insufficient stock for variant ${variant.sku}.`,
        );
      }

      subtotal = addDecimals(subtotal, lineSubtotal);
      discountAmount = addDecimals(discountAmount, lineDiscount);
      totalAmount = addDecimals(totalAmount, lineTotal);
      lineItems.push({
        product: product._id,
        productName: product.name,
        ...clothingVariantSnapshot(variant),
        quantity,
        unitPrice,
        discountPerUnit: perUnitDiscount,
        unitNetPrice: netUnitPrice,
        lineTotal,
        returnedQuantity: decimal("0"),
        allocations: [],
      });

      stockMovements.push({
        store: storeId,
        product: product._id,
        variant: variantId,
        movementType: "sale" as const,
        quantityDelta: negateDecimal(quantity),
        reason: `Clothing sale ${input.idempotencyKey}`,
        idempotencyKey: createHash("sha256")
          .update(`${input.idempotencyKey}:sale:${index}`)
          .digest("hex"),
      });
    }

    const [sale] = await SaleModel.create(
      [{
        store: storeId,
        saleIdentifier: randomUUID(),
        lineItems,
        subtotal,
        discountAmount,
        totalAmount,
        paymentMethod: input.paymentMethod,
        soldAt: new Date(),
        businessType: "clothing",
        status: "completed",
        idempotencyKey: input.idempotencyKey,
        requestHash,
      }],
      { session },
    );

    await StockMovementModel.insertMany(
      stockMovements.map((movement) => ({ ...movement, sale: sale._id })),
      { session },
    );
    for (const variantId of new Set(variantIds.map((id) => id.toHexString()))) {
      await reconcileClothingVariantAlertInTransaction(
        storeId,
        new Types.ObjectId(variantId),
        session,
      );
    }

    return { record: sale, replayed: false };
  });
}

export async function createClothingSale(
  storeId: Types.ObjectId,
  input: CreateClothingSaleInput,
): Promise<TransactionResult<InstanceType<typeof SaleModel>>> {
  const requestHash = hashRequest({
    items: input.items.map((item) => ({
      variantId: item.variantId.toLowerCase(),
      quantity: decimal(item.quantity).toString(),
      unitPrice: item.unitPrice === undefined ? null : decimal(item.unitPrice).toString(),
      discountPerUnit: item.discountPerUnit === undefined ? "0" : decimal(item.discountPerUnit).toString(),
    })),
    paymentMethod: input.paymentMethod,
  });
  const prior = await findSaleReplay(storeId, input.idempotencyKey, requestHash);
  if (prior) return { record: prior, replayed: true };

  try {
    return await createClothingSaleInTransaction(storeId, input, requestHash);
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const duplicate = await findSaleReplay(storeId, input.idempotencyKey, requestHash);
    if (duplicate) return { record: duplicate, replayed: true };
    throw error;
  }
}

async function prepareReturn(
  storeId: Types.ObjectId,
  sale: InstanceType<typeof SaleModel>,
  items: ClothingReturnLineInput[],
  session: import("mongoose").ClientSession,
  returnIdentifier: string,
): Promise<ReturnPreparation> {
  const returnedLines: ClothingReturnLine[] = [];
  let returnedValue = decimal("0");

  for (const item of items) {
    const line = sale.lineItems[item.saleLineIndex];
    if (!line || !line.variant || !line.variantSku || !line.size || !line.colour) {
      throw new ApiError(400, "SALE_LINE_NOT_RETURNABLE", "The selected sale line has no clothing variant snapshot.");
    }
    const alreadyReturned = line.returnedQuantity ?? decimal("0");
    const remaining = subtractDecimals(line.quantity, alreadyReturned);
    const quantity = decimal(item.quantity);
    if (compareDecimals(quantity, remaining) > 0) {
      throw new ApiError(409, "RETURN_QUANTITY_EXCEEDED", "Returned quantity cannot exceed the remaining sold quantity.");
    }
    const unitValue = line.unitNetPrice ?? line.unitPrice;
    const lineValue = multiplyDecimals(unitValue, quantity);
    line.returnedQuantity = addDecimals(alreadyReturned, quantity);
    returnedValue = addDecimals(returnedValue, lineValue);

    if (item.condition === "saleable") {
      const restored = await ClothingVariantModel.findOneAndUpdate(
        { _id: line.variant, store: storeId },
        { $inc: { stockQuantity: quantity } },
        { new: true, session },
      ).session(session).exec();
      if (!restored) throw new ApiError(404, "VARIANT_NOT_FOUND", "The original clothing variant was not found.");
      await reconcileClothingVariantAlertInTransaction(storeId, line.variant, session);
      await StockMovementModel.create(
        [{
          store: storeId,
          product: line.product,
          variant: line.variant,
          sale: sale._id,
          movementType: "return",
          quantityDelta: quantity,
          reason: `Return ${returnIdentifier}: ${item.reason}`,
          idempotencyKey: `${returnIdentifier}:return:${item.saleLineIndex}`,
        }],
        { session },
      );
    }

    returnedLines.push({
      saleLineIndex: item.saleLineIndex,
      product: line.product,
      productName: line.productName ?? "Product name unavailable",
      variant: line.variant,
      variantSku: line.variantSku,
      size: line.size,
      colour: line.colour,
      ...(line.designIdentifier ? { designIdentifier: line.designIdentifier } : {}),
      quantity,
      condition: item.condition,
      reason: item.reason,
      lineValue,
    });
  }

  return { lineItems: returnedLines, returnedValue };
}

async function loadClothingSaleForUpdate(
  storeId: Types.ObjectId,
  saleId: string,
  session: import("mongoose").ClientSession,
) {
  const sale = await SaleModel.findOne({
    _id: new Types.ObjectId(saleId),
    store: storeId,
    businessType: "clothing",
  }).session(session).exec();
  if (!sale) throw new ApiError(404, "SALE_NOT_FOUND", "Clothing sale was not found in this store.");
  return sale;
}

async function createReturnInTransaction(
  storeId: Types.ObjectId,
  input: CreateClothingReturnInput,
  requestHash: string,
) {
  return runInTransaction(async (session) => {
    const prior = await ClothingReturnModel.findOne({
      store: storeId,
      idempotencyKey: input.idempotencyKey,
    }).session(session).exec();
    if (prior) {
      assertSameRequest(prior, requestHash);
      return { record: prior, replayed: true };
    }

    const sale = await loadClothingSaleForUpdate(storeId, input.saleId, session);
    const returnIdentifier = randomUUID();
    const preparation = await prepareReturn(storeId, sale, input.items, session, returnIdentifier);
    const refundAmount = preparation.returnedValue;
    sale.markModified("lineItems");
    await sale.save({ session });

    const [record] = await ClothingReturnModel.create(
      [{
        store: storeId,
        originalSale: sale._id,
        returnIdentifier,
        returnedAt: new Date(),
        lineItems: preparation.lineItems,
        refundAmount,
        refundPaymentMethod: input.refundPaymentMethod,
        idempotencyKey: input.idempotencyKey,
        requestHash,
      }],
      { session },
    );
    return { record, replayed: false };
  });
}

export async function createClothingReturn(
  storeId: Types.ObjectId,
  input: CreateClothingReturnInput,
): Promise<TransactionResult<InstanceType<typeof ClothingReturnModel>>> {
  const requestHash = hashRequest({
    saleId: input.saleId.toLowerCase(),
    items: input.items,
    refundPaymentMethod: input.refundPaymentMethod,
  });
  const prior = await ClothingReturnModel.findOne({
    store: storeId,
    idempotencyKey: input.idempotencyKey,
  }).exec();
  if (prior) {
    assertSameRequest(prior, requestHash);
    return { record: prior, replayed: true };
  }
  try {
    return await createReturnInTransaction(storeId, input, requestHash);
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const duplicate = await ClothingReturnModel.findOne({
      store: storeId,
      idempotencyKey: input.idempotencyKey,
    }).exec();
    if (duplicate) {
      assertSameRequest(duplicate, requestHash);
      return { record: duplicate, replayed: true };
    }
    throw error;
  }
}

async function createExchangeInTransaction(
  storeId: Types.ObjectId,
  input: CreateClothingExchangeInput,
  requestHash: string,
) {
  return runInTransaction(async (session) => {
    const prior = await ClothingExchangeModel.findOne({
      store: storeId,
      idempotencyKey: input.idempotencyKey,
    }).session(session).exec();
    if (prior) {
      assertSameRequest(prior, requestHash);
      return { record: prior, replayed: true };
    }

    const sale = await loadClothingSaleForUpdate(storeId, input.saleId, session);
    const exchangeIdentifier = randomUUID();
    const returnIdentifier = randomUUID();
    const returnId = new Types.ObjectId();
    const exchangeId = new Types.ObjectId();
    const returnPreparation = await prepareReturn(
      storeId,
      sale,
      input.returnedItems,
      session,
      returnIdentifier,
    );

    const replacementVariants = await ClothingVariantModel.find({
      store: storeId,
      _id: { $in: input.replacementItems.map((item) => new Types.ObjectId(item.variantId)) },
    }).session(session).exec();
    const variantById = new Map(replacementVariants.map((variant) => [variant._id.toHexString(), variant]));
    const products = await ProductModel.find({
      store: storeId,
      _id: { $in: replacementVariants.map((variant) => variant.product) },
      isActive: true,
    }).session(session).exec();
    const productById = new Map(products.map((product) => [product._id.toHexString(), product]));
    const replacementLines = [];
    let replacementValue = decimal("0");

    for (const item of input.replacementItems) {
      const variantId = new Types.ObjectId(item.variantId);
      const variant = variantById.get(variantId.toHexString());
      if (!variant) throw new ApiError(404, "VARIANT_NOT_FOUND", "A replacement variant was not found in this store.");
      const product = productById.get(variant.product.toHexString());
      if (!product || !clothingCategories.some((category) => category === product.category)) {
        throw new ApiError(404, "PRODUCT_NOT_FOUND", "An active replacement clothing product was not found in this store.");
      }

      const quantity = decimal(item.quantity);
      const unitPrice = item.unitPrice === undefined ? product.sellingPrice : decimal(item.unitPrice);
      const discountPerUnit = item.discountPerUnit === undefined ? decimal("0") : decimal(item.discountPerUnit);
      if (compareDecimals(discountPerUnit, unitPrice) > 0) {
        throw new ApiError(400, "INVALID_DISCOUNT", "A per-item discount cannot exceed its unit price.");
      }
      const lineTotal = multiplyDecimals(quantity, subtractDecimals(unitPrice, discountPerUnit));
      const updatedVariant = await ClothingVariantModel.findOneAndUpdate(
        { _id: variantId, store: storeId, stockQuantity: { $gte: quantity } },
        { $inc: { stockQuantity: negateDecimal(quantity) } },
        { new: true, session },
      ).session(session).exec();
      if (!updatedVariant) {
        throw new ApiError(409, "INSUFFICIENT_VARIANT_STOCK", `Insufficient stock for replacement ${variant.sku}.`);
      }
      await reconcileClothingVariantAlertInTransaction(storeId, variantId, session);

      replacementValue = addDecimals(replacementValue, lineTotal);
      replacementLines.push({
        product: product._id,
        productName: product.name,
        ...clothingVariantSnapshot(variant),
        quantity,
        unitPrice,
        discountPerUnit,
        lineTotal,
      });
    }

    const priceDifference = subtractDecimals(replacementValue, returnPreparation.returnedValue);
    const additionalPaymentAmount = compareDecimals(priceDifference, "0") > 0
      ? priceDifference
      : decimal("0");
    const refundAmount = compareDecimals(priceDifference, "0") < 0
      ? negateDecimal(priceDifference)
      : decimal("0");
    if (compareDecimals(additionalPaymentAmount, "0") > 0 && !input.paymentMethod) {
      throw new ApiError(400, "PAYMENT_METHOD_REQUIRED", "Select a payment method for the additional amount.");
    }
    if (compareDecimals(refundAmount, "0") > 0 && !input.refundPaymentMethod) {
      throw new ApiError(400, "REFUND_METHOD_REQUIRED", "Select a refund method for the exchange difference.");
    }

    sale.markModified("lineItems");
    await sale.save({ session });
    const [returnRecord] = await ClothingReturnModel.create(
      [{
        _id: returnId,
        store: storeId,
        originalSale: sale._id,
        returnIdentifier,
        returnedAt: new Date(),
        lineItems: returnPreparation.lineItems,
        refundAmount,
        ...(input.refundPaymentMethod ? { refundPaymentMethod: input.refundPaymentMethod } : {}),
        exchangeCreditAmount: returnPreparation.returnedValue,
        exchange: exchangeId,
        idempotencyKey: createHash("sha256").update(`exchange-return:${input.idempotencyKey}`).digest("hex"),
        requestHash,
      }],
      { session },
    );
    const [exchange] = await ClothingExchangeModel.create(
      [{
        _id: exchangeId,
        store: storeId,
        originalSale: sale._id,
        return: returnRecord._id,
        exchangeIdentifier,
        exchangedAt: new Date(),
        replacementItems: replacementLines,
        returnedValue: returnPreparation.returnedValue,
        replacementValue,
        priceDifference,
        additionalPaymentAmount,
        refundAmount,
        ...(additionalPaymentAmount.toString() !== "0" && input.paymentMethod
          ? { paymentMethod: input.paymentMethod }
          : {}),
        ...(refundAmount.toString() !== "0" && input.refundPaymentMethod
          ? { refundPaymentMethod: input.refundPaymentMethod }
          : {}),
        idempotencyKey: input.idempotencyKey,
        requestHash,
      }],
      { session },
    );

    const movements: Array<{
      store: Types.ObjectId;
      product: Types.ObjectId;
      variant: Types.ObjectId;
      sale: Types.ObjectId;
      movementType: "sale";
      quantityDelta: Types.Decimal128;
      reason: string;
      idempotencyKey: string;
    }> = [];
    for (const [index, line] of replacementLines.entries()) {
      movements.push({
        store: storeId,
        product: line.product,
        variant: line.variant,
        sale: sale._id,
        movementType: "sale" as const,
        quantityDelta: negateDecimal(line.quantity),
        reason: `Exchange ${exchangeIdentifier}: replacement item`,
        idempotencyKey: `${exchangeIdentifier}:replacement:${index}`,
      });
    }
    if (movements.length > 0) await StockMovementModel.insertMany(movements, { session });

    return { record: exchange, replayed: false };
  });
}

export async function createClothingExchange(
  storeId: Types.ObjectId,
  input: CreateClothingExchangeInput,
): Promise<TransactionResult<InstanceType<typeof ClothingExchangeModel>>> {
  const requestHash = hashRequest({
    saleId: input.saleId.toLowerCase(),
    returnedItems: input.returnedItems,
    replacementItems: input.replacementItems.map((item) => ({
      ...item,
      variantId: item.variantId.toLowerCase(),
    })),
    paymentMethod: input.paymentMethod ?? null,
    refundPaymentMethod: input.refundPaymentMethod ?? null,
  });
  const prior = await ClothingExchangeModel.findOne({
    store: storeId,
    idempotencyKey: input.idempotencyKey,
  }).exec();
  if (prior) {
    assertSameRequest(prior, requestHash);
    return { record: prior, replayed: true };
  }
  try {
    return await createExchangeInTransaction(storeId, input, requestHash);
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const duplicate = await ClothingExchangeModel.findOne({
      store: storeId,
      idempotencyKey: input.idempotencyKey,
    }).exec();
    if (duplicate) {
      assertSameRequest(duplicate, requestHash);
      return { record: duplicate, replayed: true };
    }
    throw error;
  }
}

export async function listClothingSales(storeId: Types.ObjectId, query: ClothingTransactionListQuery) {
  const filter = { store: storeId, businessType: "clothing" };
  const [data, totalItems] = await Promise.all([
    SaleModel.find(filter)
      .sort({ soldAt: -1, createdAt: -1, _id: -1 })
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

export async function getClothingSale(storeId: Types.ObjectId, saleId: Types.ObjectId) {
  const sale = await SaleModel.findOne({ _id: saleId, store: storeId, businessType: "clothing" }).lean();
  if (!sale) throw new ApiError(404, "SALE_NOT_FOUND", "Clothing sale was not found in this store.");
  return sale;
}

export async function listClothingReturns(
  storeId: Types.ObjectId,
  query: ClothingTransactionListQuery,
) {
  const filter = {
    store: storeId,
    ...(query.saleId ? { originalSale: new Types.ObjectId(query.saleId) } : {}),
  };
  const [data, totalItems] = await Promise.all([
    ClothingReturnModel.find(filter)
      .sort({ returnedAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    ClothingReturnModel.countDocuments(filter),
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

export async function getClothingReturn(storeId: Types.ObjectId, returnId: Types.ObjectId) {
  const record = await ClothingReturnModel.findOne({ _id: returnId, store: storeId }).lean();
  if (!record) throw new ApiError(404, "RETURN_NOT_FOUND", "Clothing return was not found in this store.");
  return record;
}

export async function listClothingExchanges(
  storeId: Types.ObjectId,
  query: ClothingTransactionListQuery,
) {
  const filter = {
    store: storeId,
    ...(query.saleId ? { originalSale: new Types.ObjectId(query.saleId) } : {}),
  };
  const [data, totalItems] = await Promise.all([
    ClothingExchangeModel.find(filter)
      .sort({ exchangedAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    ClothingExchangeModel.countDocuments(filter),
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

export async function getClothingExchange(storeId: Types.ObjectId, exchangeId: Types.ObjectId) {
  const record = await ClothingExchangeModel.findOne({ _id: exchangeId, store: storeId }).lean();
  if (!record) throw new ApiError(404, "EXCHANGE_NOT_FOUND", "Clothing exchange was not found in this store.");
  return record;
}
