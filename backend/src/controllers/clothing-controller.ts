import type { RequestHandler } from "express";
import { Types } from "mongoose";
import {
  adjustClothingVariantStock,
  createClothingProduct,
  createClothingVariant,
  listClothingVariants,
  updateClothingVariant,
} from "../services/clothing-service";
import { ApiError } from "../utils/api-error";
import { serialize } from "../utils/serialize";
import { objectIdSchema } from "../validators/common-validator";
import {
  adjustClothingStockSchema,
  createClothingProductSchema,
  createClothingVariantSchema,
  updateClothingVariantSchema,
} from "../validators/clothing-validator";

function parseId(value: unknown, label: string): Types.ObjectId {
  const parsed = objectIdSchema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, `INVALID_${label}_ID`, `${label} ID must be a valid ObjectId.`);
  return new Types.ObjectId(parsed.data);
}

export const createClothingProductHandler: RequestHandler = async (request, response) => {
  const input = createClothingProductSchema.parse(request.body);
  const result = await createClothingProduct(response.locals.storeId, input);
  response.status(201).json({ data: serialize(result) });
};

export const createClothingVariantHandler: RequestHandler = async (request, response) => {
  const input = createClothingVariantSchema.parse(request.body);
  const variant = await createClothingVariant(
    response.locals.storeId,
    parseId(request.params.productId, "PRODUCT"),
    input,
  );
  response.status(201).json({ data: serialize(variant) });
};

export const listClothingVariantsHandler: RequestHandler = async (request, response) => {
  const variants = await listClothingVariants(
    response.locals.storeId,
    parseId(request.params.productId, "PRODUCT"),
  );
  response.status(200).json({ data: serialize(variants) });
};

export const updateClothingVariantHandler: RequestHandler = async (request, response) => {
  const input = updateClothingVariantSchema.parse(request.body);
  const variant = await updateClothingVariant(
    response.locals.storeId,
    parseId(request.params.variantId, "VARIANT"),
    input,
  );
  response.status(200).json({ data: serialize(variant) });
};

export const adjustClothingVariantStockHandler: RequestHandler = async (request, response) => {
  const input = adjustClothingStockSchema.parse(request.body);
  const variant = await adjustClothingVariantStock(
    response.locals.storeId,
    parseId(request.params.variantId, "VARIANT"),
    input.quantityDelta,
    input.reason,
  );
  response.status(200).json({ data: serialize(variant) });
};
