import type { RequestHandler } from "express";
import { Types } from "mongoose";
import { ClothingVariantModel } from "../models/clothing-variant";
import { requestForecast } from "../services/forecast-service";
import { ApiError } from "../utils/api-error";
import { addDecimals, compareDecimals, subtractDecimals } from "../utils/decimal-arithmetic";
import { forecastRequestSchema } from "../validators/forecast-validator";

export const createForecastHandler: RequestHandler = async (request, response) => {
  const parsed = forecastRequestSchema.parse(request.body);
  const config = request.app.locals as { mlServiceUrl?: unknown; mlServiceTimeoutMs?: unknown };
  if (typeof config.mlServiceUrl !== "string" || typeof config.mlServiceTimeoutMs !== "number") {
    throw new ApiError(503, "FORECAST_SERVICE_UNAVAILABLE", "Demand forecasting service is unavailable.");
  }

  const forecast = await requestForecast(response.locals.storeId, parsed, {
    url: config.mlServiceUrl,
    timeoutMs: config.mlServiceTimeoutMs,
  });
  if (!parsed.variantId) {
    response.status(200).json({ data: forecast });
    return;
  }

  const variant = await ClothingVariantModel.findOne({
    _id: new Types.ObjectId(parsed.variantId),
    store: response.locals.storeId,
  }).select({ stockQuantity: 1, lowStockThreshold: 1 }).lean();
  if (!variant) {
    throw new ApiError(404, "VARIANT_NOT_FOUND", "Clothing variant was not found in this store.");
  }

  if (forecast.status === "insufficient_history") {
    response.status(200).json({
      data: {
        ...forecast,
        currentStock: variant.stockQuantity.toString(),
        lowStockThreshold: variant.lowStockThreshold.toString(),
        potentialShortage: null,
        suggestedRestockQuantity: null,
      },
    });
    return;
  }

  const predictedDemand = forecast.forecasts.reduce(
    (total, point) => addDecimals(total, point.predictedUnits),
    Types.Decimal128.fromString("0"),
  );
  const shortage = subtractDecimals(predictedDemand, variant.stockQuantity);
  const potentialShortage = compareDecimals(shortage, "0") > 0
    ? shortage
    : Types.Decimal128.fromString("0");
  const targetStock = compareDecimals(predictedDemand, variant.lowStockThreshold) >= 0
    ? predictedDemand
    : variant.lowStockThreshold;
  const restockDifference = subtractDecimals(targetStock, variant.stockQuantity);
  const suggestedRestockQuantity = compareDecimals(restockDifference, "0") > 0
    ? restockDifference
    : Types.Decimal128.fromString("0");

  response.status(200).json({
    data: {
      ...forecast,
      currentStock: variant.stockQuantity.toString(),
      lowStockThreshold: variant.lowStockThreshold.toString(),
      potentialShortage: potentialShortage.toString(),
      suggestedRestockQuantity: suggestedRestockQuantity.toString(),
    },
  });
};
