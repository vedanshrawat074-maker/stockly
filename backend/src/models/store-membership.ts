import { model, Schema, type Types } from "mongoose";

export const membershipRoles = ["OWNER", "STAFF"] as const;
export const membershipStatuses = ["ACTIVE", "REVOKED"] as const;
export type MembershipRole = (typeof membershipRoles)[number];
export type MembershipStatus = (typeof membershipStatuses)[number];

export interface StoreMembership {
  user: Types.ObjectId;
  store: Types.ObjectId;
  role: MembershipRole;
  status: MembershipStatus;
}

const storeMembershipSchema = new Schema<StoreMembership>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    store: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    role: { type: String, enum: membershipRoles, required: true },
    status: { type: String, enum: membershipStatuses, default: "ACTIVE", required: true },
  },
  { timestamps: true },
);

storeMembershipSchema.index({ user: 1, store: 1 }, { unique: true });
storeMembershipSchema.index({ user: 1, status: 1 });
storeMembershipSchema.index({ store: 1, status: 1 });
storeMembershipSchema.index(
  { store: 1 },
  { unique: true, partialFilterExpression: { role: "OWNER" } },
);

export const StoreMembershipModel = model<StoreMembership>("StoreMembership", storeMembershipSchema);
