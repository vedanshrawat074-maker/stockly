import type { RequestHandler } from "express";
import { Types } from "mongoose";
import { getAuthorizedStore, listStoresForUser, createStoreForOwner } from "../services/store-service";
import { ApiError } from "../utils/api-error";
import { createStoreSchema, selectStoreSchema } from "../validators/store-validator";
import { saveSession } from "../middleware/authentication";

function currentUserId(response: Parameters<RequestHandler>[1]): Types.ObjectId {
  const userId = response.locals.authUser?._id;
  if (!(userId instanceof Types.ObjectId)) {
    throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Please sign in to continue.");
  }
  return userId;
}

export const listStoresHandler: RequestHandler = async (_request, response) => {
  const stores = await listStoresForUser(currentUserId(response));
  response.status(200).json({ data: stores });
};

export const getCurrentStoreHandler: RequestHandler = async (request, response) => {
  const storeId = request.session.currentStoreId;
  if (!storeId) {
    response.status(200).json({ data: null });
    return;
  }
  const parsed = selectStoreSchema.safeParse({ storeId });
  if (!parsed.success) {
    delete request.session.currentStoreId;
    await saveSession(request);
    response.status(200).json({ data: null });
    return;
  }

  try {
    const store = await getAuthorizedStore(
      currentUserId(response),
      new Types.ObjectId(parsed.data.storeId),
    );
    response.status(200).json({ data: store });
  } catch (error) {
    if (error instanceof ApiError && error.code === "STORE_ACCESS_DENIED") {
      delete request.session.currentStoreId;
      await saveSession(request);
      response.status(200).json({ data: null });
      return;
    }
    throw error;
  }
};

export const createStoreHandler: RequestHandler = async (request, response) => {
  const input = createStoreSchema.parse(request.body);
  const store = await createStoreForOwner(currentUserId(response), input);
  request.session.currentStoreId = store._id.toString();
  await saveSession(request);
  response.status(201).json({
    data: {
      id: store._id.toString(),
      name: store.name,
      address: store.address,
      timezone: store.timezone,
      currency: store.currency,
      role: "OWNER",
    },
  });
};

export const selectStoreHandler: RequestHandler = async (request, response) => {
  const input = selectStoreSchema.parse(request.body);
  const store = await getAuthorizedStore(
    currentUserId(response),
    new Types.ObjectId(input.storeId),
  );
  request.session.currentStoreId = store.id;
  await saveSession(request);
  response.status(200).json({ data: store });
};
