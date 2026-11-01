import { model, Schema, Types } from "mongoose";
import { isNonZeroDecimal } from "./decimal-validation";

export const movementTypes = [
  "receipt",
  "sale",
  "adjustment",
  "waste",
  "return",
  "transfer",
] as const;

export type MovementType = (typeof movementTypes)[number];

export interface StockMovement {
  store: Types.ObjectId;
  product: Types.ObjectId;
  batch?: Types.ObjectId;
  sale?: Types.ObjectId;
  movementType: MovementType;
  quantityDelta: Types.Decimal128;
  reason: string;
  timestamp: Date;
  idempotencyKey?: string;
}

const stockMovementSchema = new Schema<StockMovement>(
  {
    store: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    batch: { type: Schema.Types.ObjectId, ref: "Batch" },
    sale: { type: Schema.Types.ObjectId, ref: "Sale" },
    movementType: {
      type: String,
      required: true,
      enum: movementTypes,
    },
    quantityDelta: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: {
        validator: isNonZeroDecimal,
        message: "Quantity delta must be a nonzero decimal value.",
      },
    },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    timestamp: { type: Date, required: true, default: Date.now },
    idempotencyKey: { type: String, trim: true, maxlength: 160 },
  },
  { versionKey: false },
);

stockMovementSchema.index({ store: 1, product: 1, timestamp: -1 });
stockMovementSchema.index({ store: 1, sale: 1 });
stockMovementSchema.index(
  { store: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  },
);

export const StockMovementModel = model<StockMovement>("StockMovement", stockMovementSchema);
