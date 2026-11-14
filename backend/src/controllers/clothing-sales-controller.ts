import type { RequestHandler } from "express";
import { Types } from "mongoose";
import {
  createClothingExchange,
  createClothingReturn,
  createClothingSale,
  getClothingExchange,
  getClothingReturn,
  getClothingSale,
  listClothingExchanges,
  listClothingReturns,
  listClothingSales,
} from "../services/clothing-sales-service";
import { ApiError } from "../utils/api-error";
import { serialize } from "../utils/serialize";
import { objectIdSchema } from "../validators/common-validator";
import { idempotencyKeySchema } from "../validators/sale-validator";
import {
  clothingTransactionsListQuerySchema,
  createClothingExchangeSchema,
  createClothingReturnSchema,
  createClothingSaleSchema,
} from "../validators/clothing-sales-validator";

function parseId(value: unknown, label: string): Types.ObjectId {
  const parsed = objectIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, `INVALID_${label}_ID`, `${label} ID must be a valid ObjectId.`);
  }
  return new Types.ObjectId(parsed.data);
}

function parseIdempotencyKey(value: unknown): string {
  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "Provide a valid Idempotency-Key header containing 1 to 160 characters.",
    );
  }
  return parsed.data;
}

export const createClothingSaleHandler: RequestHandler = async (request, response) => {
  const input = createClothingSaleSchema.parse(request.body);
  const result = await createClothingSale(response.locals.storeId, {
    ...input,
    idempotencyKey: parseIdempotencyKey(request.get("Idempotency-Key")),
  });
  response.status(result.replayed ? 200 : 201).json({
    data: serialize(result.record),
    meta: { idempotentReplay: result.replayed },
  });
};

export const listClothingSalesHandler: RequestHandler = async (request, response) => {
  const query = clothingTransactionsListQuerySchema.parse(request.query);
  const result = await listClothingSales(response.locals.storeId, query);
  response.status(200).json(serialize(result));
};

export const getClothingSaleHandler: RequestHandler = async (request, response) => {
  const result = await getClothingSale(
    response.locals.storeId,
    parseId(request.params.saleId, "SALE"),
  );
  response.status(200).json({ data: serialize(result) });
};

export const createClothingReturnHandler: RequestHandler = async (request, response) => {
  const input = createClothingReturnSchema.parse(request.body);
  const result = await createClothingReturn(response.locals.storeId, {
    ...input,
    idempotencyKey: parseIdempotencyKey(request.get("Idempotency-Key")),
  });
  response.status(result.replayed ? 200 : 201).json({
    data: serialize(result.record),
    meta: { idempotentReplay: result.replayed },
  });
};

export const listClothingReturnsHandler: RequestHandler = async (request, response) => {
  const query = clothingTransactionsListQuerySchema.parse(request.query);
  const result = await listClothingReturns(response.locals.storeId, query);
  response.status(200).json(serialize(result));
};

export const getClothingReturnHandler: RequestHandler = async (request, response) => {
  const result = await getClothingReturn(
    response.locals.storeId,
    parseId(request.params.returnId, "RETURN"),
  );
  response.status(200).json({ data: serialize(result) });
};

export const createClothingExchangeHandler: RequestHandler = async (request, response) => {
  const input = createClothingExchangeSchema.parse(request.body);
  const result = await createClothingExchange(response.locals.storeId, {
    ...input,
    idempotencyKey: parseIdempotencyKey(request.get("Idempotency-Key")),
  });
  response.status(result.replayed ? 200 : 201).json({
    data: serialize(result.record),
    meta: { idempotentReplay: result.replayed },
  });
};

export const listClothingExchangesHandler: RequestHandler = async (request, response) => {
  const query = clothingTransactionsListQuerySchema.parse(request.query);
  const result = await listClothingExchanges(response.locals.storeId, query);
  response.status(200).json(serialize(result));
};

export const getClothingExchangeHandler: RequestHandler = async (request, response) => {
  const result = await getClothingExchange(
    response.locals.storeId,
    parseId(request.params.exchangeId, "EXCHANGE"),
  );
  response.status(200).json({ data: serialize(result) });
};
