import { model, Schema, Types } from "mongoose";
import { isNonNegativeDecimal, isPositiveDecimal } from "./decimal-validation";

export const paymentMethods = ["cash", "card", "upi", "other"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

export interface SaleBatchAllocation {
  batch: Types.ObjectId;
  quantity: Types.Decimal128;
}

export interface SaleLineItem {
  product: Types.ObjectId;
  productName?: string;
  variant?: Types.ObjectId;
  variantSku?: string;
  size?: string;
  colour?: string;
  designIdentifier?: string;
  quantity: Types.Decimal128;
  unitPrice: Types.Decimal128;
  discountPerUnit?: Types.Decimal128;
  unitNetPrice?: Types.Decimal128;
  lineTotal: Types.Decimal128;
  returnedQuantity?: Types.Decimal128;
  allocations: SaleBatchAllocation[];
}

export const saleStatuses = ["completed"] as const;
export type SaleStatus = (typeof saleStatuses)[number];

export interface Sale {
  store: Types.ObjectId;
  saleIdentifier: string;
  lineItems: SaleLineItem[];
  totalAmount: Types.Decimal128;
  status: SaleStatus;
  businessType?: "clothing";
  soldAt?: Date;
  subtotal?: Types.Decimal128;
  discountAmount?: Types.Decimal128;
  paymentMethod?: PaymentMethod;
  idempotencyKey: string;
  requestHash: string;
}

const allocationSchema = new Schema<SaleBatchAllocation>(
  {
    batch: { type: Schema.Types.ObjectId, ref: "Batch", required: true },
    quantity: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: {
        validator: isPositiveDecimal,
        message: "Allocated quantity must be greater than zero.",
      },
    },
  },
  { _id: false },
);

const lineItemSchema = new Schema<SaleLineItem>(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    productName: { type: String, trim: true, maxlength: 160 },
    variant: { type: Schema.Types.ObjectId, ref: "ClothingVariant" },
    variantSku: { type: String, trim: true, maxlength: 64 },
    size: { type: String, trim: true, maxlength: 40 },
    colour: { type: String, trim: true, maxlength: 60 },
    designIdentifier: { type: String, trim: true, maxlength: 80 },
    quantity: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: {
        validator: isPositiveDecimal,
        message: "Sale quantity must be greater than zero.",
      },
    },
    unitPrice: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: {
        validator: isNonNegativeDecimal,
        message: "Unit price must be nonnegative.",
      },
    },
    discountPerUnit: {
      type: Schema.Types.Decimal128,
      validate: {
        validator: isNonNegativeDecimal,
        message: "Per-unit discount must be nonnegative.",
      },
    },
    unitNetPrice: {
      type: Schema.Types.Decimal128,
      validate: {
        validator: isNonNegativeDecimal,
        message: "Net unit price must be nonnegative.",
      },
    },
    lineTotal: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: {
        validator: isNonNegativeDecimal,
        message: "Line total must be nonnegative.",
      },
    },
    returnedQuantity: {
      type: Schema.Types.Decimal128,
      validate: {
        validator: isNonNegativeDecimal,
        message: "Returned quantity must be nonnegative.",
      },
    },
    allocations: { type: [allocationSchema], required: true },
  },
  { _id: false },
);

const saleSchema = new Schema<Sale>(
  {
    store: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    saleIdentifier: { type: String, required: true, trim: true, maxlength: 100 },
    lineItems: {
      type: [lineItemSchema],
      required: true,
      validate: {
        validator: (value: SaleLineItem[]) => value.length > 0,
        message: "Sale must include at least one line item.",
      },
    },
    totalAmount: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: {
        validator: isNonNegativeDecimal,
        message: "Sale total must be nonnegative.",
      },
    },
    status: { type: String, required: true, enum: saleStatuses, default: "completed" },
    businessType: { type: String, enum: ["clothing"] },
    soldAt: { type: Date },
    subtotal: {
      type: Schema.Types.Decimal128,
      validate: { validator: isNonNegativeDecimal, message: "Subtotal must be nonnegative." },
    },
    discountAmount: {
      type: Schema.Types.Decimal128,
      validate: { validator: isNonNegativeDecimal, message: "Discount amount must be nonnegative." },
    },
    paymentMethod: { type: String, enum: paymentMethods },
    idempotencyKey: { type: String, required: true, trim: true, maxlength: 160 },
    requestHash: { type: String, required: true, match: /^[a-f\d]{64}$/ },
  },
  { timestamps: true },
);

saleSchema.index({ store: 1, saleIdentifier: 1 }, { unique: true });
saleSchema.index({ store: 1, idempotencyKey: 1 }, { unique: true });
saleSchema.index({ store: 1, createdAt: -1 });
saleSchema.index({ store: 1, status: 1, createdAt: 1 });
saleSchema.index({ store: 1, businessType: 1, soldAt: -1 });

export const SaleModel = model<Sale>("Sale", saleSchema);
