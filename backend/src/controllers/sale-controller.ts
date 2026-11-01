import type { RequestHandler } from "express";
import { Types } from "mongoose";
import { createSale, listSales } from "../services/sale-service";
import { ApiError } from "../utils/api-error";
import { serialize } from "../utils/serialize";
import { idempotencyKeySchema, salesListQuerySchema, createSaleSchema } from "../validators/sale-validator";

export const createSaleHandler: RequestHandler = async (request, response) => {
  const input = createSaleSchema.parse(request.body);
  const parsedKey = idempotencyKeySchema.safeParse(request.get("Idempotency-Key"));
  if (!parsedKey.success) {
    throw new ApiError(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "Provide a valid Idempotency-Key header containing 1 to 160 characters.",
    );
  }

  const result = await createSale(response.locals.storeId, {
    ...input,
    idempotencyKey: parsedKey.data,
  });

  response.status(result.replayed ? 200 : 201).json({
    data: serialize(result.sale),
    meta: { idempotentReplay: result.replayed },
  });
};

export const listSalesHandler: RequestHandler = async (request, response) => {
  const query = salesListQuerySchema.parse(request.query);
  const result = await listSales(
    new Types.ObjectId(response.locals.storeId),
    query,
  );
  response.status(200).json(serialize(result));
};
