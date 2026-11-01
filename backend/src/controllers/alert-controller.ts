import type { RequestHandler } from "express";
import { Types } from "mongoose";
import { acknowledgeAlert, listAlerts, resolveAlert } from "../services/alert-service";
import { generateStoreAlerts } from "../services/alert-generation-service";
import { ApiError } from "../utils/api-error";
import { serialize } from "../utils/serialize";
import { alertIdSchema, alertsListQuerySchema, runAlertCheckSchema } from "../validators/alert-validator";

function parseAlertId(value: unknown): Types.ObjectId {
  const parsed = alertIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, "INVALID_ALERT_ID", "Alert ID must be a valid ObjectId.");
  }
  return new Types.ObjectId(parsed.data);
}

export const listAlertsHandler: RequestHandler = async (request, response) => {
  const query = alertsListQuerySchema.parse(request.query);
  const result = await listAlerts(response.locals.storeId, query);
  response.status(200).json(serialize(result));
};

export const runAlertCheckHandler: RequestHandler = async (request, response) => {
  const input = runAlertCheckSchema.parse(request.body ?? {});
  const result = await generateStoreAlerts(response.locals.storeId, input);
  response.status(200).json({ data: result });
};

export const acknowledgeAlertHandler: RequestHandler = async (request, response) => {
  const alert = await acknowledgeAlert(
    response.locals.storeId,
    parseAlertId(request.params.alertId),
  );
  response.status(200).json({ data: serialize(alert) });
};

export const resolveAlertHandler: RequestHandler = async (request, response) => {
  const alert = await resolveAlert(
    response.locals.storeId,
    parseAlertId(request.params.alertId),
  );
  response.status(200).json({ data: serialize(alert) });
};
