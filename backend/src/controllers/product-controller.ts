import type { RequestHandler } from "express";
import { Types } from "mongoose";
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  updateProduct,
} from "../services/product-service";
import { ApiError } from "../utils/api-error";
import { serialize } from "../utils/serialize";
import { objectIdSchema } from "../validators/common-validator";
import {
  createProductSchema,
  productListQuerySchema,
  updateProductSchema,
} from "../validators/product-validator";

function parseProductId(value: unknown): Types.ObjectId {
  const parsed = objectIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, "INVALID_PRODUCT_ID", "Product ID must be a valid ObjectId.");
  }
  return new Types.ObjectId(parsed.data);
}

export const createProductHandler: RequestHandler = async (request, response) => {
  const input = createProductSchema.parse(request.body);
  const product = await createProduct(response.locals.storeId, input);
  response.status(201).json({ data: serialize(product) });
};

export const listProductsHandler: RequestHandler = async (request, response) => {
  const query = productListQuerySchema.parse(request.query);
  const result = await listProducts(response.locals.storeId, query);
  response.status(200).json(serialize(result));
};

export const getProductHandler: RequestHandler = async (request, response) => {
  const product = await getProduct(response.locals.storeId, parseProductId(request.params.productId));
  response.status(200).json({ data: serialize(product) });
};

export const updateProductHandler: RequestHandler = async (request, response) => {
  const input = updateProductSchema.parse(request.body);
  const product = await updateProduct(
    response.locals.storeId,
    parseProductId(request.params.productId),
    input,
  );
  response.status(200).json({ data: serialize(product) });
};

export const deleteProductHandler: RequestHandler = async (request, response) => {
  const result = await deleteProduct(
    response.locals.storeId,
    parseProductId(request.params.productId),
  );
  response.status(200).json({ data: result });
};
