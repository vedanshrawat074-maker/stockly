import { Types } from "mongoose";
import { BatchModel } from "../models/batch";
import { ClothingVariantModel, type ClothingVariant } from "../models/clothing-variant";
import { InventoryModel } from "../models/inventory";
import { ProductModel } from "../models/product";
import { StoreModel } from "../models/store";
import { addDecimals, compareDecimals, subtractDecimals } from "../utils/decimal-arithmetic";
import { ApiError } from "../utils/api-error";
import { clothingCategories } from "../validators/clothing-validator";
import { compareCalendarDates, getExpiryDateOnly, getStoreLocalDate } from "./expiry-calendar";
import { requestForecast, type ForecastRequest } from "./forecast-service";
import { getDailyDemandHistory } from "./demand-history-service";

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
export type ClothingSellingTrend = "FAST_SELLING" | "SLOW_SELLING" | "STEADY" | "INSUFFICIENT_HISTORY";

type ClothingVariantRow = ClothingVariant & {
  _id: Types.ObjectId;
  createdAt?: Date;
  productName: string;
  productSku: string;
  productCreatedAt?: Date;
};

type ClothingForecastResult = {
  variant: ClothingVariantRow;
  forecast?: ForecastResult;
  forecastFailure?: "INSUFFICIENT_HISTORY" | "FORECAST_UNAVAILABLE";
};

export type ClothingRestockingRecommendation = {
  productId: string;
  productName: string;
  productSku: string;
  productTrend: ClothingSellingTrend;
  variantId: string;
  variantSku: string;
  size: string;
  colour: string;
  designIdentifier?: string;
  unit: "piece";
  status: RecommendationStatus;
  currentStock: string;
  lowStockThreshold: string;
  lowStockTriggered: boolean;
  forecastStatus: ForecastResult["status"] | "unavailable";
  forecastDemand: string | null;
  safetyBuffer: string | null;
  potentialShortage: string | null;
  suggestedRestockQuantity: string | null;
  reason: string;
};

function sumForecastValues(values: string[]): Types.Decimal128 {
  return values.reduce<Types.Decimal128>(
    (total, value) => addDecimals(total, value),
    Types.Decimal128.fromString("0"),
  );
}

function classifyClothingSalesTrend(
  dailyDemand: Array<{ unitsSold: string }>,
  minimumHistoryDays = 14,
): ClothingSellingTrend {
  const requiredDays = Math.max(14, minimumHistoryDays);
  if (dailyDemand.length < requiredDays) return "INSUFFICIENT_HISTORY";

  const previousWeek = sumForecastValues(dailyDemand.slice(-14, -7).map((day) => day.unitsSold));
  const recentWeek = sumForecastValues(dailyDemand.slice(-7).map((day) => day.unitsSold));
  const comparison = compareDecimals(recentWeek, previousWeek);
  if (comparison > 0) return "FAST_SELLING";
  if (comparison < 0 || compareDecimals(recentWeek, "0") === 0) return "SLOW_SELLING";
  return "STEADY";
}

export function buildClothingRestockingRecommendation(input: {
  variant: ClothingVariantRow;
  productTrend: ClothingSellingTrend;
  forecast?: ForecastResult;
  forecastFailure?: "INSUFFICIENT_HISTORY" | "FORECAST_UNAVAILABLE";
  planningHorizonDays: number;
  safetyBufferDays: number;
}): ClothingRestockingRecommendation {
  const { variant, forecast } = input;
  const currentStock = variant.stockQuantity;
  const lowStockThreshold = variant.lowStockThreshold;
  const lowStockTriggered =
    compareDecimals(lowStockThreshold, "0") > 0 &&
    compareDecimals(currentStock, lowStockThreshold) <= 0;
  const unavailable = !forecast || forecast.status === "insufficient_history";
  if (unavailable) {
    const insufficientHistory =
      input.forecastFailure === "INSUFFICIENT_HISTORY" ||
      forecast?.status === "insufficient_history";
    const status = insufficientHistory ? "INSUFFICIENT_HISTORY" : "FORECAST_UNAVAILABLE";
    const reason = insufficientHistory
      ? "There is not enough recorded variant history to estimate demand. No restock quantity was produced."
      : "Demand forecasting is unavailable. No restock quantity was produced.";
    return {
      productId: variant.product.toHexString(),
      productName: variant.productName,
      productSku: variant.productSku,
      productTrend: input.productTrend,
      variantId: variant._id.toHexString(),
      variantSku: variant.sku,
      size: variant.size,
      colour: variant.colour,
      ...(variant.designIdentifier ? { designIdentifier: variant.designIdentifier } : {}),
      unit: "piece",
      status,
      currentStock: currentStock.toString(),
      lowStockThreshold: lowStockThreshold.toString(),
      lowStockTriggered,
      forecastStatus: forecast?.status ?? "unavailable",
      forecastDemand: null,
      safetyBuffer: null,
      potentialShortage: null,
      suggestedRestockQuantity: null,
      reason: lowStockTriggered
        ? `${reason} Stock (${currentStock.toString()}) is also at or below the variant threshold (${lowStockThreshold.toString()}).`
        : reason,
    };
  }

  const expectedForecastDays = input.planningHorizonDays + input.safetyBufferDays;
  if (forecast.forecasts.length !== expectedForecastDays) {
    throw new ApiError(
      502,
      "INVALID_FORECAST_RESPONSE",
      "Demand forecasting service returned an unexpected forecast length.",
    );
  }
  const planningDemand = sumForecastValues(
    forecast.forecasts.slice(0, input.planningHorizonDays).map((point) => point.predictedUnits),
  );
  const safetyBuffer = sumForecastValues(
    forecast.forecasts
      .slice(input.planningHorizonDays, expectedForecastDays)
      .map((point) => point.predictedUnits),
  );
  const forecastTarget = addDecimals(planningDemand, safetyBuffer);
  const targetStock = compareDecimals(forecastTarget, lowStockThreshold) >= 0
    ? forecastTarget
    : lowStockThreshold;
  const shortage = subtractDecimals(planningDemand, currentStock);
  const potentialShortage = compareDecimals(shortage, "0") > 0
    ? shortage
    : Types.Decimal128.fromString("0");
  const restockDifference = subtractDecimals(targetStock, currentStock);
  const suggested = compareDecimals(restockDifference, "0") > 0
    ? restockDifference
    : Types.Decimal128.fromString("0");

  return {
    productId: variant.product.toHexString(),
    productName: variant.productName,
    productSku: variant.productSku,
    productTrend: input.productTrend,
    variantId: variant._id.toHexString(),
    variantSku: variant.sku,
    size: variant.size,
    colour: variant.colour,
    ...(variant.designIdentifier ? { designIdentifier: variant.designIdentifier } : {}),
    unit: "piece",
    status: compareDecimals(suggested, "0") > 0 ? "RESTOCK_RECOMMENDED" : "NO_RESTOCK_NEEDED",
    currentStock: currentStock.toString(),
    lowStockThreshold: lowStockThreshold.toString(),
    lowStockTriggered,
    forecastStatus: forecast.status,
    forecastDemand: planningDemand.toString(),
    safetyBuffer: safetyBuffer.toString(),
    potentialShortage: potentialShortage.toString(),
    suggestedRestockQuantity: suggested.toString(),
    reason:
      `${input.planningHorizonDays}-day variant demand is ${planningDemand.toString()} pieces; ` +
      `${input.safetyBufferDays}-day safety buffer is ${safetyBuffer.toString()}. ` +
      `Target stock is max(forecast demand plus buffer, variant threshold) = ${targetStock.toString()}; ` +
      `current variant stock is ${currentStock.toString()}; suggested quantity is ${suggested.toString()}.`,
  };
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
  const store = await StoreModel.findById(storeId).select({ timezone: 1, shopType: 1 }).lean();
  if (!store) throw new ApiError(404, "STORE_NOT_FOUND", "Store was not found.");
  if (store.shopType === "clothing") {
    return getClothingRestockingRecommendations(storeId, query, config, now);
  }
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

async function getClothingRestockingRecommendations(
  storeId: Types.ObjectId,
  query: RestockingQuery,
  config: RestockingConfig,
  now: Date,
) {
  const match: Record<string, unknown> = {
    store: storeId,
    ...(query.productId ? { product: new Types.ObjectId(query.productId) } : {}),
  };
  const variantPages = await ClothingVariantModel.aggregate<{
    data: ClothingVariantRow[];
    metadata: Array<{ totalItems: number }>;
  }>([
    { $match: match },
    {
      $lookup: {
        from: ProductModel.collection.name,
        localField: "product",
        foreignField: "_id",
        as: "parentProduct",
      },
    },
    { $unwind: "$parentProduct" },
    {
      $match: {
        "parentProduct.store": storeId,
        "parentProduct.isActive": true,
        "parentProduct.category": { $in: clothingCategories },
      },
    },
    { $sort: { "parentProduct.name": 1, product: 1, size: 1, colour: 1, sku: 1, _id: 1 } },
    {
      $facet: {
        data: [
          { $skip: (query.page - 1) * query.limit },
          { $limit: query.limit },
          {
            $project: {
              _id: 1,
              store: 1,
              product: 1,
              size: 1,
              colour: 1,
              designIdentifier: 1,
              sku: 1,
              stockQuantity: 1,
              lowStockThreshold: 1,
              createdAt: 1,
              productName: "$parentProduct.name",
              productSku: "$parentProduct.sku",
              productCreatedAt: "$parentProduct.createdAt",
            },
          },
        ],
        metadata: [{ $count: "totalItems" }],
      },
    },
  ]);
  const page = variantPages[0] ?? { data: [], metadata: [] };
  const totalItems = page.metadata[0]?.totalItems ?? 0;
  if (query.productId && totalItems === 0) {
    const productExists = await ProductModel.exists({
      _id: new Types.ObjectId(query.productId),
      store: storeId,
      isActive: true,
      category: { $in: clothingCategories },
    });
    if (!productExists) {
      throw new ApiError(404, "PRODUCT_NOT_FOUND", "Active clothing product was not found in this store.");
    }
  }

  const productRows = new Map<string, ClothingVariantRow>();
  for (const variant of page.data) {
    productRows.set(variant.product.toHexString(), variant);
  }
  const [historyByProduct, forecastRows] = await Promise.all([
    Promise.all([...productRows.entries()].map(async ([productId, variant]): Promise<
      [string, Array<{ date: string; unitsSold: string }>]
    > => {
      const historyRange = forecastHistoryRange(now, variant.productCreatedAt ?? now);
      if (historyRange.startDate > historyRange.endDate) {
        return [productId, []];
      }
      const history = await getDailyDemandHistory(storeId, {
        productId,
        ...historyRange,
        page: 1,
        limit: 1,
      });
      return [productId, history.data[0]?.dailyDemand ?? []];
    })),
    Promise.all(page.data.map(async (variant): Promise<ClothingForecastResult> => {
      const historyRange = forecastHistoryRange(now, variant.createdAt ?? variant.productCreatedAt ?? now);
      if (historyRange.startDate > historyRange.endDate) {
        return { variant, forecastFailure: "INSUFFICIENT_HISTORY" };
      }
      try {
        const forecast = await requestForecast(storeId, {
          productId: variant.product.toHexString(),
          variantId: variant._id.toHexString(),
          ...historyRange,
          horizonDays: config.planningHorizonDays + config.safetyBufferDays,
          rollingWindowDays: 7,
        }, {
          url: config.mlServiceUrl,
          timeoutMs: config.mlServiceTimeoutMs,
        });
        return {
          variant,
          forecast,
          ...(forecast.status === "insufficient_history" ? { forecastFailure: "INSUFFICIENT_HISTORY" as const } : {}),
        };
      } catch (error) {
        if (!isForecastUnavailable(error)) throw error;
        return { variant, forecastFailure: "FORECAST_UNAVAILABLE" };
      }
    })),
  ]);

  const demandByProduct = new Map(historyByProduct);
  const recommendations = forecastRows.map(({ variant, forecast, forecastFailure }) => {
    const trend = classifyClothingSalesTrend(
      demandByProduct.get(variant.product.toHexString()) ?? [],
      forecast?.minimumHistoryDays ?? 14,
    );
    return buildClothingRestockingRecommendation({
      variant,
      productTrend: trend,
      ...(forecast ? { forecast } : {}),
      ...(forecastFailure ? { forecastFailure } : {}),
      planningHorizonDays: config.planningHorizonDays,
      safetyBufferDays: config.safetyBufferDays,
    });
  });

  return {
    data: recommendations,
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    },
    trendRule: "Compares gross units in the latest 7 days with the prior 7 days; zero recent sales is slow, equal positive sales is steady.",
  };
}
