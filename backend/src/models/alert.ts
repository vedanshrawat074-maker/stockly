import { model, Schema, Types } from "mongoose";

export const alertTypes = ["LOW_STOCK", "EXPIRING_SOON", "EXPIRED_STOCK"] as const;
export type AlertType = (typeof alertTypes)[number];

export const alertStatuses = ["ACTIVE", "ACKNOWLEDGED", "RESOLVED"] as const;
export type AlertStatus = (typeof alertStatuses)[number];

export const alertSeverities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type AlertSeverity = (typeof alertSeverities)[number];

export interface Alert {
  store: Types.ObjectId;
  type: AlertType;
  product: Types.ObjectId;
  batch?: Types.ObjectId;
  status: AlertStatus;
  severity: AlertSeverity;
  deduplicationKey: string;
  title: string;
  details: string;
  firstDetectedAt: Date;
  lastDetectedAt: Date;
  resolvedAt?: Date;
}

const alertSchema = new Schema<Alert>(
  {
    store: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    type: { type: String, enum: alertTypes, required: true },
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    batch: { type: Schema.Types.ObjectId, ref: "Batch" },
    status: { type: String, enum: alertStatuses, required: true, default: "ACTIVE" },
    severity: { type: String, enum: alertSeverities, required: true },
    deduplicationKey: { type: String, required: true, trim: true, maxlength: 200 },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    details: { type: String, required: true, trim: true, maxlength: 2000 },
    firstDetectedAt: { type: Date, required: true },
    lastDetectedAt: { type: Date, required: true },
    resolvedAt: { type: Date },
  },
  { timestamps: true },
);

alertSchema.index({ store:  1, deduplicationKey: 1 }, { unique: true });
alertSchema.index({ store: 1, status: 1, lastDetectedAt: -1 });
alertSchema.index({ store: 1, type: 1, status: 1, lastDetectedAt: -1 });

export const AlertModel = model<Alert>("Alert", alertSchema);
