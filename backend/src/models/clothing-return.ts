import { model, Schema, type Types } from "mongoose";
import { paymentMethods, type PaymentMethod } from "./sale";
import { isNonNegativeDecimal, isPositiveDecimal } from "./decimal-validation";

export const returnConditions = ["saleable", "damaged"] as const;
export type ReturnCondition = (typeof returnConditions)[number];

export interface ClothingReturnLine {
  saleLineIndex: number;
  product: Types.ObjectId;
  productName: string;
  variant: Types.ObjectId;
  variantSku: string;
  size: string;
  colour: string;
  designIdentifier?: string;
  quantity: Types.Decimal128;
  condition: ReturnCondition;
  reason: string;
  lineValue: Types.Decimal128;
}

export interface ClothingReturn {
  store: Types.ObjectId;
  originalSale: Types.ObjectId;
  returnIdentifier: string;
  returnedAt: Date;
  lineItems: ClothingReturnLine[];
  refundAmount: Types.Decimal128;
  refundPaymentMethod?: PaymentMethod;
  exchangeCreditAmount?: Types.Decimal128;
  exchange?: Types.ObjectId;
  idempotencyKey: string;
  requestHash: string;
}

const returnLineSchema = new Schema<ClothingReturnLine>(
  {
    saleLineIndex: { type: Number, required: true, min: 0, max: 99, validate: Number.isInteger },
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
      validate: { validator: isPositiveDecimal, message: "Returned quantity must be positive." },
    },
    condition: { type: String, required: true, enum: returnConditions },
    reason: { type: String, required: true, trim: true, maxlength: 200 },
    lineValue: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: { validator: isNonNegativeDecimal, message: "Return value must be nonnegative." },
    },
  },
  { _id: false },
);

const clothingReturnSchema = new Schema<ClothingReturn>(
  {
    store: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    originalSale: { type: Schema.Types.ObjectId, ref: "Sale", required: true },
    returnIdentifier: { type: String, required: true, trim: true, maxlength: 100 },
    returnedAt: { type: Date, required: true, default: Date.now },
    lineItems: {
      type: [returnLineSchema],
      required: true,
      validate: { validator: (items: ClothingReturnLine[]) => items.length > 0 },
    },
    refundAmount: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: { validator: isNonNegativeDecimal, message: "Refund amount must be nonnegative." },
    },
    refundPaymentMethod: { type: String, enum: paymentMethods },
    exchangeCreditAmount: {
      type: Schema.Types.Decimal128,
      validate: { validator: isNonNegativeDecimal, message: "Exchange credit must be nonnegative." },
    },
    exchange: { type: Schema.Types.ObjectId, ref: "ClothingExchange" },
    idempotencyKey: { type: String, required: true, trim: true, maxlength: 160 },
    requestHash: { type: String, required: true, match: /^[a-f\d]{64}$/ },
  },
  { timestamps: true },
);

clothingReturnSchema.index({ store: 1, idempotencyKey: 1 }, { unique: true });
clothingReturnSchema.index({ store: 1, originalSale: 1, createdAt: -1 });
clothingReturnSchema.index({ store: 1, returnedAt: -1 });
clothingReturnSchema.index({ store: 1, returnIdentifier: 1 }, { unique: true });

export const ClothingReturnModel = model<ClothingReturn>("ClothingReturn", clothingReturnSchema);
