import { model, Schema, type Types } from "mongoose";
import { isNonNegativeDecimal } from "./decimal-validation";

export interface ClothingVariant {
  store: Types.ObjectId;
  product: Types.ObjectId;
  size: string;
  colour: string;
  designIdentifier?: string;
  sku: string;
  stockQuantity: Types.Decimal128;
  lowStockThreshold: Types.Decimal128;
}

const clothingVariantSchema = new Schema<ClothingVariant>(
  {
    store: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    size: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
    colour: { type: String, required: true, trim: true, lowercase: true, maxlength: 60 },
    designIdentifier: { type: String, trim: true, uppercase: true, maxlength: 80 },
    sku: { type: String, required: true, trim: true, uppercase: true, maxlength: 64 },
    stockQuantity: {
      type: Schema.Types.Decimal128,
      required: true,
      default: "0",
      validate: { validator: isNonNegativeDecimal, message: "Stock quantity must be nonnegative." },
    },
    lowStockThreshold: {
      type: Schema.Types.Decimal128,
      required: true,
      default: "0",
      validate: { validator: isNonNegativeDecimal, message: "Low-stock threshold must be nonnegative." },
    },
  },
  { timestamps: true },
);

clothingVariantSchema.index(
  { store: 1, product: 1, size: 1, colour: 1, designIdentifier: 1 },
  { unique: true },
);
clothingVariantSchema.index({ store: 1, sku: 1 }, { unique: true });
clothingVariantSchema.index({ store: 1, product: 1 });

export const ClothingVariantModel = model<ClothingVariant>("ClothingVariant", clothingVariantSchema);
