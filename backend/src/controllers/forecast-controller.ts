import type { RequestHandler } from "express";
import { requestForecast } from "../services/forecast-service";
import { ApiError } from "../utils/api-error";
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
  response.status(200).json({ data: forecast });
};
