import { model, Schema, Types } from "mongoose";
import { isNonNegativeDecimal } from "./decimal-validation";

export interface Inventory {
  store: Types.ObjectId;
  product: Types.ObjectId;
  minimumStockThreshold: Types.Decimal128;
}

const inventorySchema = new Schema<Inventory>(
  {
    store: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    minimumStockThreshold: {
      type: Schema.Types.Decimal128,
      required: true,
      default: () => Types.Decimal128.fromString("0"),
      validate: {
        validator: isNonNegativeDecimal,
        message: "Minimum stock threshold must be a nonnegative decimal value.",
      },
    },
  },
  { timestamps: true },
);

inventorySchema.index({ store: 1, product: 1 }, { unique: true });

export const InventoryModel = model<Inventory>("Inventory", inventorySchema);
