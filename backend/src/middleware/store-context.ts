import type { RequestHandler } from "express";
import { Types } from "mongoose";
import { membershipRoles, StoreMembershipModel } from "../models/store-membership";
import { UserModel } from "../models/user";
import { ApiError } from "../utils/api-error";
import { objectIdSchema } from "../validators/common-validator";
import { destroySession } from "./authentication";

export function storeContext(nodeEnv: string): RequestHandler {
  return async (request, response, next) => {
    try {
      if (request.session.userId) {
        const userId = objectIdSchema.safeParse(request.session.userId);
        const currentStoreId = objectIdSchema.safeParse(request.session.currentStoreId);
        if (!userId.success) {
          await destroySession(request);
          throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Please sign in to continue.");
        }

        const user = await UserModel.findById(new Types.ObjectId(userId.data));
        if (!user || user.status !== "active") {
          await destroySession(request);
          throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Please sign in to continue.");
        }
        response.locals.authUser = user;

        if (!currentStoreId.success) {
          throw new ApiError(409, "STORE_SELECTION_REQUIRED", "Select an authorized store to continue.");
        }

        const membership = await StoreMembershipModel.findOne({
          user: new Types.ObjectId(userId.data),
          store: new Types.ObjectId(currentStoreId.data),
          status: "ACTIVE",
          role: { $in: membershipRoles },
        }).select({ _id: 1 });
        if (!membership) {
          delete request.session.currentStoreId;
          throw new ApiError(403, "STORE_ACCESS_DENIED", "You no longer have access to the selected store.");
        }
        response.locals.storeId = new Types.ObjectId(currentStoreId.data);
        response.locals.userId = new Types.ObjectId(userId.data);
        next();
        return;
      }

      if (nodeEnv !== "development") {
        throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Please sign in to continue.");
      }

      const parsed = objectIdSchema.safeParse(request.get("X-Store-Id"));
      if (!parsed.success) {
        throw new ApiError(
          400,
          "INVALID_STORE_CONTEXT",
          "Provide a valid development-only X-Store-Id header.",
          parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        );
      }

      response.locals.storeId = new Types.ObjectId(parsed.data);
      next();
    } catch (error) {
      next(error);
    }
  };
}
