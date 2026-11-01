import { Types } from "mongoose";
import { AlertModel, type AlertStatus, type AlertType } from "../models/alert";
import { ApiError } from "../utils/api-error";

export type AlertListQuery = {
  page: number;
  limit: number;
  type?: AlertType;
  status?: AlertStatus;
};

export async function listAlerts(storeId: Types.ObjectId, query: AlertListQuery) {
  const filter = {
    store: storeId,
    ...(query.type ? { type: query.type } : {}),
    ...(query.status ? { status: query.status } : {}),
  };
  const [data, totalItems] = await Promise.all([
    AlertModel.find(filter)
      .sort({ lastDetectedAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    AlertModel.countDocuments(filter),
  ]);
  return {
    data,
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    },
  };
}

export async function acknowledgeAlert(
  storeId: Types.ObjectId,
  alertId: Types.ObjectId,
) {
  const alert = await AlertModel.findOne({ _id: alertId, store: storeId });
  if (!alert) throw new ApiError(404, "ALERT_NOT_FOUND", "Alert was not found.");
  if (alert.status === "RESOLVED") {
    throw new ApiError(409, "INVALID_ALERT_TRANSITION", "A resolved alert cannot be acknowledged.");
  }
  if (alert.status !== "ACKNOWLEDGED") {
    alert.status = "ACKNOWLEDGED";
    await alert.save();
  }
  return alert;
}

export async function resolveAlert(
  storeId: Types.ObjectId,
  alertId: Types.ObjectId,
) {
  const alert = await AlertModel.findOne({ _id: alertId, store: storeId });
  if (!alert) throw new ApiError(404, "ALERT_NOT_FOUND", "Alert was not found.");
  if (alert.status === "RESOLVED") {
    throw new ApiError(409, "INVALID_ALERT_TRANSITION", "Alert is already resolved.");
  }
  alert.status = "RESOLVED";
  alert.resolvedAt = new Date();
  await alert.save();
  return alert;
}
