import { model, Schema, type Types } from "mongoose";
import { isNonNegativeDecimal, isPositiveDecimal } from "./decimal-validation";
import { paymentMethods, type PaymentMethod } from "./sale";

export interface ClothingExchangeLine {
  product: Types.ObjectId;
  productName: string;
  variant: Types.ObjectId;
  variantSku: string;
  size: string;
  colour: string;
  designIdentifier?: string;
  quantity: Types.Decimal128;
  unitPrice: Types.Decimal128;
  discountPerUnit: Types.Decimal128;
  lineTotal: Types.Decimal128;
}

export interface ClothingExchange {
  store: Types.ObjectId;
  originalSale: Types.ObjectId;
  return: Types.ObjectId;
  exchangeIdentifier: string;
  exchangedAt: Date;
  replacementItems: ClothingExchangeLine[];
  returnedValue: Types.Decimal128;
  replacementValue: Types.Decimal128;
  priceDifference: Types.Decimal128;
  additionalPaymentAmount: Types.Decimal128;
  refundAmount: Types.Decimal128;
  paymentMethod?: PaymentMethod;
  refundPaymentMethod?: PaymentMethod;
  idempotencyKey: string;
  requestHash: string;
}

const exchangeLineSchema = new Schema<ClothingExchangeLine>(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    productName: { type: String, required: true, trim: true, maxlength: 160 },
    variant: { type: Schema.Types.ObjectId, ref: "ClothingVariant", required: true },
    variantSku: { type: String, required: true, trim: true, maxlength: 64 },
    size: { type: String, required: true, trim: true, maxlength: 40 },
    colour: { type: String, required: true, trim: true, maxlength: 60 },
    designIdentifier: { type: String, trim: true, maxlength: 80 },
    quantity: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: { validator: isPositiveDecimal, message: "Replacement quantity must be positive." },
    },
    unitPrice: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: { validator: isNonNegativeDecimal, message: "Unit price must be nonnegative." },
    },
    discountPerUnit: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: { validator: isNonNegativeDecimal, message: "Per-unit discount must be nonnegative." },
    },
    lineTotal: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: { validator: isNonNegativeDecimal, message: "Line total must be nonnegative." },
    },
  },
  { _id: false },
);

const clothingExchangeSchema = new Schema<ClothingExchange>(
  {
    store: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    originalSale: { type: Schema.Types.ObjectId, ref: "Sale", required: true },
    return: { type: Schema.Types.ObjectId, ref: "ClothingReturn", required: true },
    exchangeIdentifier: { type: String, required: true, trim: true, maxlength: 100 },
    exchangedAt: { type: Date, required: true, default: Date.now },
    replacementItems: {
      type: [exchangeLineSchema],
      required: true,
      validate: { validator: (items: ClothingExchangeLine[]) => items.length > 0 },
    },
    returnedValue: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: { validator: isNonNegativeDecimal },
    },
    replacementValue: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: { validator: isNonNegativeDecimal },
    },
    priceDifference: { type: Schema.Types.Decimal128, required: true },
    additionalPaymentAmount: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: { validator: isNonNegativeDecimal },
    },
    refundAmount: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: { validator: isNonNegativeDecimal },
    },
    paymentMethod: { type: String, enum: paymentMethods },
    refundPaymentMethod: { type: String, enum: paymentMethods },
    idempotencyKey: { type: String, required: true, trim: true, maxlength: 160 },
    requestHash: { type: String, required: true, match: /^[a-f\d]{64}$/ },
  },
  { timestamps: true },
);

clothingExchangeSchema.index({ store: 1, idempotencyKey: 1 }, { unique: true });
clothingExchangeSchema.index({ store: 1, originalSale: 1, createdAt: -1 });
clothingExchangeSchema.index({ store: 1, exchangedAt: -1 });
clothingExchangeSchema.index({ store: 1, exchangeIdentifier: 1 }, { unique: true });

export const ClothingExchangeModel = model<ClothingExchange>("ClothingExchange", clothingExchangeSchema);
