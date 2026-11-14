import { model, Schema, type Types } from "mongoose";

export const shopTypes = ["grocery", "clothing"] as const;
export type ShopType = (typeof shopTypes)[number];

export interface Store {
  name: string;
  address: string;
  timezone: string;
  currency: string;
  shopType?: ShopType;
}

const storeSchema = new Schema<Store>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    address: { type: String, required: true, trim: true, maxlength: 500 },
    timezone: { type: String, required: true, trim: true },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      minlength: 3,
      maxlength: 3,
      match: /^[A-Z]{3}$/,
    },
    shopType: { type: String, enum: shopTypes, required: true, default: "grocery" },
  },
  { timestamps: true },
);

export const StoreModel = model<Store>("Store", storeSchema);
export type StoreId = Types.ObjectId;
