import { z } from "zod";
import { paginationSchema } from "./common-validator";
import { alertStatuses, alertTypes } from "../models/alert";

export const alertsListQuerySchema = paginationSchema
  .extend({
    type: z.enum(alertTypes).optional(),
    status: z.enum(alertStatuses).optional(),
  })
  .strict();

export const runAlertCheckSchema = z
  .object({
    expiryWarningDays: z.number().int().min(0).max(365).optional(),
  })
  .strict();

export const alertIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Alert ID must be a valid ObjectId.");
