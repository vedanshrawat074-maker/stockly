import { model, Schema, Types } from "mongoose";
import { isNonNegativeDecimal } from "./decimal-validation";

export interface Product {
  store: Types.ObjectId;
  name: string;
  sku: string;
  barcode?: string;
  category: string;
  baseUnit: string;
  sellingPrice: Types.Decimal128;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const productSchema = new Schema<Product>(
  {
    store: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    sku: { type: String, required: true, trim: true, uppercase: true, maxlength: 80 },
    barcode: { type: String, trim: true, maxlength: 80 },
    category: { type: String, required: true, trim: true, maxlength: 100 },
    baseUnit: { type: String, required: true, trim: true, maxlength: 40 },
    sellingPrice: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: {
        validator: isNonNegativeDecimal,
        message: "Selling price must be a nonnegative decimal value.",
      },
    },
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

productSchema.index({ store: 1, sku: 1 }, { unique: true });
productSchema.index(
  { store: 1, barcode: 1 },
  { partialFilterExpression: { barcode: { $type: "string" } } },
);
productSchema.index({ store: 1, category: 1, isActive: 1 });

export const ProductModel = model<Product>("Product", productSchema);
