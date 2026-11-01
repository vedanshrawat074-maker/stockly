import type { RequestHandler } from "express";
import { getDailyDemandHistory } from "../services/demand-history-service";
import { serialize } from "../utils/serialize";
import { demandHistoryQuerySchema } from "../validators/demand-validator";

export const getDemandHistoryHandler: RequestHandler = async (request, response) => {
  const query = demandHistoryQuerySchema.parse(request.query);
  const result = await getDailyDemandHistory(response.locals.storeId, query);
  response.status(200).json(serialize(result));
};
