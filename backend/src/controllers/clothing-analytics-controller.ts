import type { RequestHandler } from "express";
import { getClothingAnalytics } from "../services/clothing-analytics-service";
import { clothingAnalyticsQuerySchema } from "../validators/clothing-analytics-validator";

export const clothingAnalyticsHandler: RequestHandler = async (request, response) => {
  const query = clothingAnalyticsQuerySchema.parse(request.query);
  const result = await getClothingAnalytics(response.locals.storeId, query);
  response.status(200).json({ data: result });
};
