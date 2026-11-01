import { model, Schema, type Types } from "mongoose";

export interface Store {
  name: string;
  address: string;
  timezone: string;
  currency: string;
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
  },
  { timestamps: true },
);

export const StoreModel = model<Store>("Store", storeSchema);
export type StoreId = Types.ObjectId;
