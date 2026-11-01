import type { RequestHandler } from "express";
import { getRestockingRecommendations } from "../services/restocking-service";
import { ApiError } from "../utils/api-error";
import { restockingQuerySchema } from "../validators/restocking-validator";

export const listRestockingRecommendations: RequestHandler = async (request, response) => {
  const query = restockingQuerySchema.parse(request.query);
  const config = request.app.locals as {
    mlServiceUrl?: unknown;
    mlServiceTimeoutMs?: unknown;
    restockingPlanningHorizonDays?: unknown;
    restockingSafetyBufferDays?: unknown;
  };
  if (
    typeof config.mlServiceUrl !== "string" ||
    typeof config.mlServiceTimeoutMs !== "number" ||
    typeof config.restockingPlanningHorizonDays !== "number" ||
    typeof config.restockingSafetyBufferDays !== "number"
  ) {
    throw new ApiError(
      503,
      "RESTOCKING_SERVICE_UNAVAILABLE",
      "Restocking recommendations are unavailable.",
    );
  }

  const result = await getRestockingRecommendations(response.locals.storeId, query, {
    mlServiceUrl: config.mlServiceUrl,
    mlServiceTimeoutMs: config.mlServiceTimeoutMs,
    planningHorizonDays: config.restockingPlanningHorizonDays,
    safetyBufferDays: config.restockingSafetyBufferDays,
  });
  response.status(200).json(result);
};
