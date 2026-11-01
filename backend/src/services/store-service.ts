import mongoose, { Types } from "mongoose";
import { membershipRoles, StoreMembershipModel, type MembershipRole } from "../models/store-membership";
import { StoreModel } from "../models/store";
import { ApiError } from "../utils/api-error";

export type StoreSummary = {
  id: string;
  name: string;
  address: string;
  timezone: string;
  currency: string;
  role: MembershipRole;
};

export async function createStoreForOwner(
  userId: Types.ObjectId,
  input: { name: string; address: string; timezone: string; currency: string },
) {
  const session = await mongoose.startSession();
  let createdStore: InstanceType<typeof StoreModel> | undefined;
  try {
    await session.withTransaction(async () => {
      const [store] = await StoreModel.create([input], { session });
      await StoreMembershipModel.create(
        [{ user: userId, store: store._id, role: "OWNER", status: "ACTIVE" }],
        { session },
      );
      createdStore = store;
    });
    if (!createdStore) throw new Error("Store onboarding transaction completed without a store.");
    return createdStore;
  } finally {
    await session.endSession();
  }
}

export async function listStoresForUser(userId: Types.ObjectId): Promise<StoreSummary[]> {
  const memberships = await StoreMembershipModel.find({
    user: userId,
    status: "ACTIVE",
    role: { $in: membershipRoles },
  })
    .populate<{ store: { _id: Types.ObjectId; name: string; address: string; timezone: string; currency: string } | null }>("store")
    .lean();
  return memberships.flatMap((membership) => {
    if (!membership.store) return [];
    return [{
      id: membership.store._id.toString(),
      name: membership.store.name,
      address: membership.store.address,
      timezone: membership.store.timezone,
      currency: membership.store.currency,
      role: membership.role,
    }];
  });
}

export async function getAuthorizedStore(
  userId: Types.ObjectId,
  storeId: Types.ObjectId,
): Promise<StoreSummary> {
  const membership = await StoreMembershipModel.findOne({
    user: userId,
    store: storeId,
    status: "ACTIVE",
    role: { $in: membershipRoles },
  }).populate("store");
  const store = membership?.store;
  if (!membership || !store || !(store instanceof StoreModel)) {
    throw new ApiError(403, "STORE_ACCESS_DENIED", "You do not have access to this store.");
  }
  return {
    id: store._id.toString(),
    name: store.name,
    address: store.address,
    timezone: store.timezone,
    currency: store.currency,
    role: membership.role,
  };
}
