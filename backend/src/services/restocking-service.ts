import { Types } from "mongoose";
import { BatchModel } from "../models/batch";
import { InventoryModel } from "../models/inventory";
import { ProductModel } from "../models/product";
import { StoreModel } from "../models/store";
import { addDecimals, compareDecimals, subtractDecimals } from "../utils/decimal-arithmetic";
import { ApiError } from "../utils/api-error";
import { compareCalendarDates, getExpiryDateOnly, getStoreLocalDate } from "./expiry-calendar";
import { requestForecast, type ForecastRequest } from "./forecast-service";

export type RestockingQuery = {
  productId?: string;
  page: number;
  limit: number;
};

export type RestockingConfig = {
  mlServiceUrl: string;
  mlServiceTimeoutMs: number;
  planningHorizonDays: number;
  safetyBufferDays: number;
};

type RecommendationStatus =
  | "NO_RESTOCK_NEEDED"
  | "RESTOCK_RECOMMENDED"
  | "INSUFFICIENT_HISTORY"
  | "FORECAST_UNAVAILABLE";

type ForecastResult = Awaited<ReturnType<typeof requestForecast>>;

function sumForecastValues(values: string[]): Types.Decimal128 {
  return values.reduce<Types.Decimal128>(
    (total, value) => addDecimals(total, value),
    Types.Decimal128.fromString("0"),
  );
}

export function buildRestockingRecommendation(input: {
  product: { _id: Types.ObjectId; name: string; baseUnit: string };
  usableStock: Types.Decimal128;
  minimumStockThreshold?: Types.Decimal128;
  forecast?: ForecastResult;
  forecastFailure?: "INSUFFICIENT_HISTORY" | "FORECAST_UNAVAILABLE";
  planningHorizonDays: number;
  safetyBufferDays: number;
}): {
  productId: string;
  productName: string;
  unit: string;
  status: RecommendationStatus;
  currentUsableStock: string;
  forecastStatus: ForecastResult["status"] | "unavailable";
  forecastDemand: string | null;
  safetyBuffer: string | null;
  suggestedRestockQuantity: string | null;
  lowStockFallback: { threshold: string | null; triggered: boolean } | null;
  reason: string;
} {
  const { product, usableStock } = input;
  const currentUsableStock = usableStock.toString();
  if (!input.forecast || input.forecast.status === "insufficient_history") {
    const insufficientHistory =
      input.forecastFailure === "INSUFFICIENT_HISTORY" ||
      input.forecast?.status === "insufficient_history";
    const threshold = input.minimumStockThreshold;
    const fallbackTriggered =
      threshold !== undefined &&
      compareDecimals(threshold, "0") > 0 &&
      compareDecimals(usableStock, threshold) <= 0;
    const fallback = {
      threshold: threshold?.toString() ?? null,
      triggered: fallbackTriggered,
    };
    const status = insufficientHistory ? "INSUFFICIENT_HISTORY" : "FORECAST_UNAVAILABLE";
    const reason = insufficientHistory
      ? `There is not enough recorded history to estimate demand for ${input.planningHorizonDays} planning days. No quantity recommendation was produced.`
      : "Demand forecasting is unavailable. No quantity recommendation was produced.";

    return {
      productId: product._id.toHexString(),
      productName: product.name,
      unit: product.baseUnit,
      status,
      currentUsableStock,
      forecastStatus: input.forecast?.status ?? "unavailable",
      forecastDemand: null,
      safetyBuffer: null,
      suggestedRestockQuantity: null,
      lowStockFallback: fallback,
      reason: fallbackTriggered
        ? `${reason} Separately, usable stock (${currentUsableStock} ${product.baseUnit}) is at or below the minimum threshold (${threshold!.toString()} ${product.baseUnit}).`
        : reason,
    };
  }

  const expectedForecastDays = input.planningHorizonDays + input.safetyBufferDays;
  if (input.forecast.forecasts.length !== expectedForecastDays) {
    throw new ApiError(
      502,
      "INVALID_FORECAST_RESPONSE",
      "Demand forecasting service returned an unexpected forecast length.",
    );
  }

  const planningDemand = sumForecastValues(
    input.forecast.forecasts
      .slice(0, input.planningHorizonDays)
      .map((point) => point.predictedUnits),
  );
  const safetyBuffer = sumForecastValues(
    input.forecast.forecasts
      .slice(input.planningHorizonDays, expectedForecastDays)
      .map((point) => point.predictedUnits),
  );
  const targetStock = addDecimals(planningDemand, safetyBuffer);
  const difference = subtractDecimals(targetStock, usableStock);
  const suggested = compareDecimals(difference, "0") > 0
    ? difference
    : Types.Decimal128.fromString("0");
  const status =
    compareDecimals(suggested, "0") > 0 ? "RESTOCK_RECOMMENDED" : "NO_RESTOCK_NEEDED";

  return {
    productId: product._id.toHexString(),
    productName: product.name,
    unit: product.baseUnit,
    status,
    currentUsableStock,
    forecastStatus: input.forecast.status,
    forecastDemand: planningDemand.toString(),
    safetyBuffer: safetyBuffer.toString(),
    suggestedRestockQuantity: suggested.toString(),
    lowStockFallback: null,
    reason:
      `${input.planningHorizonDays}-day forecast demand is ${planningDemand.toString()} ${product.baseUnit}; ` +
      `${input.safetyBufferDays}-day safety buffer is ${safetyBuffer.toString()} ${product.baseUnit}. ` +
      `Target stock is ${targetStock.toString()} ${product.baseUnit}; usable stock is ${currentUsableStock} ${product.baseUnit}; ` +
      `suggested quantity is max(0, target - usable stock) = ${suggested.toString()} ${product.baseUnit}.`,
  };
}

function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function forecastHistoryRange(now: Date, productCreatedAt: Date): { startDate: string; endDate: string } {
  const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const recentStart = new Date(endDate);
  recentStart.setUTCDate(recentStart.getUTCDate() - 29);
  const createdDate = new Date(Date.UTC(
    productCreatedAt.getUTCFullYear(),
    productCreatedAt.getUTCMonth(),
    productCreatedAt.getUTCDate(),
  ));
  const startDate = createdDate > recentStart ? createdDate : recentStart;
  return { startDate: dateString(startDate), endDate: dateString(endDate) };
}

function isForecastUnavailable(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    [
      "FORECAST_SERVICE_UNAVAILABLE",
      "FORECAST_SERVICE_TIMEOUT",
      "INVALID_FORECAST_RESPONSE",
      "INVALID_DEMAND_HISTORY",
    ].includes(error.code)
  );
}

export async function getRestockingRecommendations(
  storeId: Types.ObjectId,
  query: RestockingQuery,
  config: RestockingConfig,
  now: Date = new Date(),
) {
  if (config.planningHorizonDays + config.safetyBufferDays > 30) {
    throw new ApiError(500, "INVALID_RESTOCKING_CONFIGURATION", "Restocking forecast configuration is invalid.");
  }
  const store = await StoreModel.findById(storeId).select({ timezone: 1 }).lean();
  if (!store) throw new ApiError(404, "STORE_NOT_FOUND", "Store was not found.");
  const localToday = getStoreLocalDate(now, store.timezone);
  const productFilter: { store: Types.ObjectId; isActive: true; _id?: Types.ObjectId } = {
    store: storeId,
    isActive: true,
  };
  if (query.productId) productFilter._id = new Types.ObjectId(query.productId);

  const [products, totalItems] = await Promise.all([
    ProductModel.find(productFilter)
      .select({ _id: 1, name: 1, baseUnit: 1, createdAt: 1 })
      .sort({ name: 1, _id: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    ProductModel.countDocuments(productFilter),
  ]);
  if (query.productId && totalItems === 0) {
    throw new ApiError(404, "PRODUCT_NOT_FOUND", "Active product was not found in this store.");
  }

  const productIds = products.map((product) => product._id);
  const [batches, inventories] = productIds.length === 0
    ? [[], []]
    : await Promise.all([
        BatchModel.find({ store: storeId, product: { $in: productIds } })
          .select({ product: 1, remainingQuantity: 1, expiryDate: 1 })
          .lean(),
        InventoryModel.find({ store: storeId, product: { $in: productIds } })
          .select({ product: 1, minimumStockThreshold: 1 })
          .lean(),
      ]);

  const usableByProduct = new Map<string, Types.Decimal128>();
  for (const batch of batches) {
    if (
      batch.expiryDate &&
      compareCalendarDates(getExpiryDateOnly(batch.expiryDate), localToday) < 0
    ) {
      continue;
    }
    const key = batch.product.toHexString();
    usableByProduct.set(
      key,
      addDecimals(
        usableByProduct.get(key) ?? Types.Decimal128.fromString("0"),
        batch.remainingQuantity,
      ),
    );
  }
  const thresholdByProduct = new Map(
    inventories.map((inventory) => [
      inventory.product.toHexString(),
      inventory.minimumStockThreshold,
    ]),
  );
  const recommendations = await Promise.all(
    products.map(async (product) => {
      const historyRange = forecastHistoryRange(now, product.createdAt ?? now);
      const forecastInput: ForecastRequest = {
        productId: product._id.toHexString(),
        ...historyRange,
        horizonDays: config.planningHorizonDays + config.safetyBufferDays,
        rollingWindowDays: 7,
      };
      let forecast: ForecastResult | undefined;
      let forecastFailure: "INSUFFICIENT_HISTORY" | "FORECAST_UNAVAILABLE" | undefined;
      if (historyRange.startDate > historyRange.endDate) {
        forecastFailure = "INSUFFICIENT_HISTORY";
      } else {
        try {
          forecast = await requestForecast(storeId, forecastInput, {
            url: config.mlServiceUrl,
            timeoutMs: config.mlServiceTimeoutMs,
          });
          if (forecast.status === "insufficient_history") forecastFailure = "INSUFFICIENT_HISTORY";
        } catch (error) {
          if (!isForecastUnavailable(error)) throw error;
          forecastFailure = "FORECAST_UNAVAILABLE";
        }
      }

      return buildRestockingRecommendation({
        product,
        usableStock:
          usableByProduct.get(product._id.toHexString()) ?? Types.Decimal128.fromString("0"),
        minimumStockThreshold: thresholdByProduct.get(product._id.toHexString()),
        ...(forecast ? { forecast } : {}),
        ...(forecastFailure ? { forecastFailure } : {}),
        planningHorizonDays: config.planningHorizonDays,
        safetyBufferDays: config.safetyBufferDays,
      });
    }),
  );

  return {
    data: recommendations,
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    },
  };
}
