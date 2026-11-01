import { model, Schema, Types } from "mongoose";
import { isLessThanOrEqual, isNonNegativeDecimal } from "./decimal-validation";

export interface Batch {
  store: Types.ObjectId;
  product: Types.ObjectId;
  batchNumber: string;
  receivedQuantity: Types.Decimal128;
  remainingQuantity: Types.Decimal128;
  unitCost: Types.Decimal128;
  receivedDate: Date;
  expiryDate?: Date;
}

const batchSchema = new Schema<Batch>(
  {
    store: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    batchNumber: { type: String, required: true, trim: true, maxlength: 100 },
    receivedQuantity: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: {
        validator: isNonNegativeDecimal,
        message: "Received quantity must be nonnegative.",
      },
    },
    remainingQuantity: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: {
        validator: isNonNegativeDecimal,
        message: "Remaining quantity must be nonnegative.",
      },
    },
    unitCost: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: {
        validator: isNonNegativeDecimal,
        message: "Unit cost must be nonnegative.",
      },
    },
    receivedDate: { type: Date, required: true },
    expiryDate: {
      type: Date,
      validate: {
        validator: (value: Date | undefined) => value === undefined || !Number.isNaN(value.getTime()),
        message: "Expiry date must be a valid date when provided.",
      },
    },
  },
  { timestamps: true },
);

batchSchema.path("remainingQuantity").validate(function (this: Batch) {
  return isLessThanOrEqual(this.remainingQuantity, this.receivedQuantity);
}, "Remaining quantity cannot exceed received quantity.");

batchSchema.index({ store: 1, product: 1, batchNumber: 1 }, { unique: true });
batchSchema.index({ store: 1, product: 1, expiryDate: 1 });

export const BatchModel = model<Batch>("Batch", batchSchema);
