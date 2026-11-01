import { model, Schema, Types } from "mongoose";
import { isNonNegativeDecimal, isPositiveDecimal } from "./decimal-validation";

export interface SaleBatchAllocation {
  batch: Types.ObjectId;
  quantity: Types.Decimal128;
}

export interface SaleLineItem {
  product: Types.ObjectId;
  quantity: Types.Decimal128;
  unitPrice: Types.Decimal128;
  lineTotal: Types.Decimal128;
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
    lineTotal: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: {
        validator: isNonNegativeDecimal,
        message: "Line total must be nonnegative.",
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
    idempotencyKey: { type: String, required: true, trim: true, maxlength: 160 },
    requestHash: { type: String, required: true, match: /^[a-f\d]{64}$/ },
  },
  { timestamps: true },
);

saleSchema.index({ store: 1, saleIdentifier: 1 }, { unique: true });
saleSchema.index({ store: 1, idempotencyKey: 1 }, { unique: true });
saleSchema.index({ store: 1, createdAt: -1 });
saleSchema.index({ store: 1, status: 1, createdAt: 1 });

export const SaleModel = model<Sale>("Sale", saleSchema);
