import { getDailyDemandHistory } from "./demand-history-service";
import { ApiError } from "../utils/api-error";
import { forecastResponseSchema, type forecastRequestSchema } from "../validators/forecast-validator";
import type { z } from "zod";

export type ForecastRequest = z.infer<typeof forecastRequestSchema>;

export type ForecastServiceConfig = {
  url: string;
  timeoutMs: number;
};

export async function requestForecast(
  storeId: Parameters<typeof getDailyDemandHistory>[0],
  request: ForecastRequest,
  config: ForecastServiceConfig,
) {
  const history = await getDailyDemandHistory(storeId, {
    productId: request.productId,
    startDate: request.startDate,
    endDate: request.endDate,
    page: 1,
    limit: 1,
  });
  const productHistory = history.data[0];
  if (!productHistory) {
    throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product was not found in this store.");
  }
  if (
    productHistory.storeId.toLowerCase() !== storeId.toHexString().toLowerCase() ||
    productHistory.productId.toLowerCase() !== request.productId.toLowerCase()
  ) {
    throw new ApiError(502, "INVALID_DEMAND_HISTORY", "Historical demand data did not match the requested scope.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const forecastHistory = {
      storeId: productHistory.storeId,
      productId: productHistory.productId,
      unit: productHistory.unit,
      availability: productHistory.availability,
      availabilityNote: productHistory.availabilityNote,
      dailyDemand: productHistory.dailyDemand,
    };
    const response = await fetch(`${config.url.replace(/\/+$/, "")}/forecast`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        history: forecastHistory,
        horizonDays: request.horizonDays,
        rollingWindowDays: request.rollingWindowDays,
      }),
    });

    if (!response.ok) {
      console.error("Demand forecasting service returned an unsuccessful status.", {
        status: response.status,
      });
      throw new ApiError(502, "FORECAST_SERVICE_UNAVAILABLE", "Demand forecasting service is unavailable.");
    }

    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      throw new ApiError(502, "INVALID_FORECAST_RESPONSE", "Demand forecasting service returned invalid data.");
    }

    const parsed = forecastResponseSchema.safeParse(responseBody);
    if (
      !parsed.success ||
      parsed.data.storeId.toLowerCase() !== storeId.toHexString().toLowerCase() ||
      parsed.data.productId.toLowerCase() !== request.productId.toLowerCase() ||
      parsed.data.horizonDays !== request.horizonDays ||
      (parsed.data.status === "insufficient_history"
        ? parsed.data.forecasts.length !== 0
        : parsed.data.forecasts.length !== request.horizonDays)
    ) {
      throw new ApiError(502, "INVALID_FORECAST_RESPONSE", "Demand forecasting service returned invalid data.");
    }

    return parsed.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) {
      throw new ApiError(504, "FORECAST_SERVICE_TIMEOUT", "Demand forecasting service timed out.");
    }
    console.error("Demand forecasting service request failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    throw new ApiError(503, "FORECAST_SERVICE_UNAVAILABLE", "Demand forecasting service is unavailable.");
  } finally {
    clearTimeout(timeout);
  }
}
