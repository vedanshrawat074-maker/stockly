import type { RequestHandler } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import {
  getInventoryForProduct,
  listBatches,
  listInventory,
  receiveBatch,
} from "../services/inventory-service";
import { ApiError } from "../utils/api-error";
import { serialize } from "../utils/serialize";
import {
  inventoryListQuerySchema,
  productIdSchema,
  receiveBatchSchema,
} from "../validators/inventory-validator";

const idempotencyKeySchema = z.string().trim().min(1).max(160);

function parseProductId(value: unknown): Types.ObjectId {
  const parsed = productIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, "INVALID_PRODUCT_ID", "Product ID must be a valid ObjectId.");
  }
  return new Types.ObjectId(parsed.data);
}

export const listInventoryHandler: RequestHandler = async (request, response) => {
  const query = inventoryListQuerySchema.parse(request.query);
  const result = await listInventory(response.locals.storeId, query.page, query.limit);
  response.status(200).json(serialize(result));
};

export const getInventoryHandler: RequestHandler = async (request, response) => {
  const result = await getInventoryForProduct(
    response.locals.storeId,
    parseProductId(request.params.productId),
  );
  response.status(200).json({ data: serialize(result) });
};

export const receiveBatchHandler: RequestHandler = async (request, response) => {
  const input = receiveBatchSchema.parse(request.body);
  const rawIdempotencyKey = request.get("Idempotency-Key");
  let idempotencyKey: string | undefined;

  if (rawIdempotencyKey !== undefined) {
    const parsedKey = idempotencyKeySchema.safeParse(rawIdempotencyKey);
    if (!parsedKey.success) {
      throw new ApiError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be between 1 and 160 characters.");
    }
    idempotencyKey = parsedKey.data;
  }

  const result = await receiveBatch(
    response.locals.storeId,
    parseProductId(request.params.productId),
    { ...input, ...(idempotencyKey ? { idempotencyKey } : {}) },
  );
  response.status(201).json({ data: serialize(result) });
};

export const listBatchesHandler: RequestHandler = async (request, response) => {
  const productId = parseProductId(request.params.productId);
  const query = inventoryListQuerySchema.parse(request.query);
  const result = await listBatches(
    response.locals.storeId,
    productId,
    query.page,
    query.limit,
  );
  response.status(200).json(serialize(result));
};
