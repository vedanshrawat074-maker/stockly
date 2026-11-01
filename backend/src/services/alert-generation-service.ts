import { Types } from "mongoose";
import { AlertModel, type AlertSeverity, type AlertType } from "../models/alert";
import { BatchModel } from "../models/batch";
import { InventoryModel } from "../models/inventory";
import { ProductModel } from "../models/product";
import { StoreModel } from "../models/store";
import { addDecimals, compareDecimals } from "../utils/decimal-arithmetic";
import { ApiError } from "../utils/api-error";
import {
  addCalendarDays,
  calendarDateString,
  compareCalendarDates,
  getExpiryDateOnly,
  getStoreLocalDate,
} from "./expiry-calendar";
import { runInTransaction } from "./transaction-service";

export type AlertCheckOptions = {
  expiryWarningDays?: number;
  now?: Date;
};

export type AlertCheckResult = {
  created: number;
  refreshed: number;
  resolved: number;
  activeConditions: number;
};

export type AlertCondition = {
  type: AlertType;
  product: Types.ObjectId;
  batch?: Types.ObjectId;
  severity: AlertSeverity;
  deduplicationKey: string;
  title: string;
  details: string;
};

function isDuplicateKeyError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function getSeverityForExpiry(daysUntilExpiry: number): AlertSeverity {
  return daysUntilExpiry <= 1 ? "CRITICAL" : daysUntilExpiry <= 3 ? "HIGH" : "MEDIUM";
}

function daysBetween(left: { year: number; month: number; day: number }, right: {
  year: number;
  month: number;
  day: number;
}): number {
  const leftUtc = Date.UTC(left.year, left.month - 1, left.day);
  const rightUtc = Date.UTC(right.year, right.month - 1, right.day);
  return (rightUtc - leftUtc) / 86_400_000;
}

export function computeAlertConditions(
  storeTimezone: string,
  products: Array<{
    _id: Types.ObjectId;
    name: string;
    isActive: boolean;
  }>,
  inventories: Array<{
    product: Types.ObjectId;
    minimumStockThreshold: Types.Decimal128;
  }>,
  batches: Array<{
    _id: Types.ObjectId;
    product: Types.ObjectId;
    batchNumber: string;
    remainingQuantity: Types.Decimal128;
    expiryDate?: Date;
  }>,
  now: Date,
  expiryWarningDays: number,
): AlertCondition[] {
  const localToday = getStoreLocalDate(now, storeTimezone);
  const warningEnd = addCalendarDays(localToday, expiryWarningDays);
  const productsById = new Map(products.map((product) => [product._id.toHexString(), product]));
  const inventoryByProduct = new Map(
    inventories.map((inventory) => [inventory.product.toHexString(), inventory]),
  );
  const usableByProduct = new Map<string, Types.Decimal128>();

  for (const batch of batches) {
    if (batch.expiryDate && compareCalendarDates(getExpiryDateOnly(batch.expiryDate), localToday) < 0) {
      continue;
    }

    const key = batch.product.toHexString();
    const current = usableByProduct.get(key) ?? Types.Decimal128.fromString("0");
    usableByProduct.set(key, addDecimals(current, batch.remainingQuantity));
  }

  const conditions: AlertCondition[] = [];
  for (const product of products) {
    if (!product.isActive) continue;

    const inventory = inventoryByProduct.get(product._id.toHexString());
    if (!inventory || compareDecimals(inventory.minimumStockThreshold, "0") <= 0) continue;

    const usable = usableByProduct.get(product._id.toHexString()) ?? Types.Decimal128.fromString("0");
    if (compareDecimals(usable, inventory.minimumStockThreshold) <= 0) {
      const severity =
        compareDecimals(usable, "0") === 0
          ? "CRITICAL"
          : compareDecimals(usable, inventory.minimumStockThreshold) < 0
            ? "HIGH"
            : "MEDIUM";
      conditions.push({
        type: "LOW_STOCK",
        product: product._id,
        severity,
        deduplicationKey: `LOW_STOCK:${product._id.toHexString()}`,
        title: `Low stock: ${product.name}`,
        details: `Usable stock is ${usable.toString()} and the minimum threshold is ${inventory.minimumStockThreshold.toString()}.`,
      });
    }
  }

  for (const batch of batches) {
    if (!batch.expiryDate || compareDecimals(batch.remainingQuantity, "0") <= 0) continue;

    const product = productsById.get(batch.product.toHexString());
    if (!product) continue;

    const expiryDate = getExpiryDateOnly(batch.expiryDate);
    const relativeToToday = compareCalendarDates(expiryDate, localToday);
    if (relativeToToday < 0) {
      conditions.push({
        type: "EXPIRED_STOCK",
        product: batch.product,
        batch: batch._id,
        severity: "CRITICAL",
        deduplicationKey: `EXPIRED_STOCK:${batch._id.toHexString()}`,
        title: `Expired stock: ${product.name}`,
        details: `Batch ${batch.batchNumber} expired on ${calendarDateString(expiryDate)} and has ${batch.remainingQuantity.toString()} remaining.`,
      });
    } else if (compareCalendarDates(expiryDate, warningEnd) <= 0) {
      const daysUntilExpiry = daysBetween(localToday, expiryDate);
      conditions.push({
        type: "EXPIRING_SOON",
        product: batch.product,
        batch: batch._id,
        severity: getSeverityForExpiry(daysUntilExpiry),
        deduplicationKey: `EXPIRING_SOON:${batch._id.toHexString()}`,
        title: `Expiring soon: ${product.name}`,
        details: `Batch ${batch.batchNumber} expires on ${calendarDateString(expiryDate)} and has ${batch.remainingQuantity.toString()} remaining.`,
      });
    }
  }

  return conditions;
}

async function checkStoreAlertsInTransaction(
  storeId: Types.ObjectId,
  expiryWarningDays: number,
  now: Date,
): Promise<AlertCheckResult> {
  return runInTransaction(async (session) => {
    const store = await StoreModel.findById(storeId).session(session).lean();
    if (!store) throw new ApiError(404, "STORE_NOT_FOUND", "Store was not found.");
    getStoreLocalDate(now, store.timezone);

    const products = await ProductModel.find({ store: storeId }).session(session).lean();
    const inventories = await InventoryModel.find({ store: storeId }).session(session).lean();
    const batches = await BatchModel.find({ store: storeId }).session(session).lean();
    const conditions = computeAlertConditions(
      store.timezone,
      products,
      inventories,
      batches,
      now,
      expiryWarningDays,
    );
    const currentByKey = new Map(conditions.map((condition) => [condition.deduplicationKey, condition]));
    const existing = await AlertModel.find({
      store: storeId,
      status: { $ne: "RESOLVED" },
    })
      .session(session)
      .exec();
    const existingByKey = new Map(existing.map((alert) => [alert.deduplicationKey, alert]));
    let created = 0;
    let refreshed = 0;
    let resolved = 0;

    for (const condition of conditions) {
      const alert = existingByKey.get(condition.deduplicationKey);
      const prior =
        alert ??
        (await AlertModel.findOne({
          store: storeId,
          deduplicationKey: condition.deduplicationKey,
        })
          .session(session)
          .exec());

      await AlertModel.findOneAndUpdate(
        { store: storeId, deduplicationKey: condition.deduplicationKey },
        [
          {
            $set: {
              store: { $ifNull: ["$store", storeId] },
              type: condition.type,
              product: condition.product,
              batch: condition.batch ?? "$$REMOVE",
              status: {
                $cond: [{ $eq: ["$status", "ACKNOWLEDGED"] }, "ACKNOWLEDGED", "ACTIVE"],
              },
              severity: condition.severity,
              deduplicationKey: condition.deduplicationKey,
              title: condition.title,
              details: condition.details,
              firstDetectedAt: {
                $cond: [
                  { $eq: ["$status", "RESOLVED"] },
                  now,
                  { $ifNull: ["$firstDetectedAt", now] },
                ],
              },
              lastDetectedAt: now,
              resolvedAt: "$$REMOVE",
              createdAt: { $ifNull: ["$createdAt", now] },
              updatedAt: now,
            },
          },
        ],
        { upsert: true, new: true, session, timestamps: false },
      ).exec();

      if (prior) refreshed += 1;
      else created += 1;
    }

    for (const alert of existing) {
      if (currentByKey.has(alert.deduplicationKey)) continue;
      alert.status = "RESOLVED";
      alert.resolvedAt = now;
      await alert.save({ session });
      resolved += 1;
    }

    return { created, refreshed, resolved, activeConditions: conditions.length };
  });
}

export async function generateStoreAlerts(
  storeId: Types.ObjectId,
  options: AlertCheckOptions = {},
): Promise<AlertCheckResult> {
  const expiryWarningDays = options.expiryWarningDays ?? 7;
  if (!Number.isInteger(expiryWarningDays) || expiryWarningDays < 0 || expiryWarningDays > 365) {
    throw new ApiError(
      400,
      "INVALID_EXPIRY_WARNING_WINDOW",
      "Expiry warning days must be an integer between 0 and 365.",
    );
  }
  const now = options.now ?? new Date();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await checkStoreAlertsInTransaction(storeId, expiryWarningDays, now);
    } catch (error) {
      if (!isDuplicateKeyError(error) || attempt === 2) throw error;
    }
  }

  throw new Error("Alert generation retry loop exited unexpectedly.");
}
