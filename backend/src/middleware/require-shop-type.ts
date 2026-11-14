import type { RequestHandler } from "express";
import { StoreModel, type ShopType } from "../models/store";
import { ApiError } from "../utils/api-error";

export function requireShopType(expectedType: ShopType): RequestHandler {
  return async (_request, response, next) => {
    try {
      const store = await StoreModel.findById(response.locals.storeId).select({ shopType: 1 }).lean();
      if (!store) {
        throw new ApiError(404, "STORE_NOT_FOUND", "Store was not found.");
      }

      if ((store.shopType ?? "grocery") !== expectedType) {
        throw new ApiError(
          403,
          "SHOP_TYPE_NOT_SUPPORTED",
          `This operation is only available for ${expectedType} stores.`,
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
