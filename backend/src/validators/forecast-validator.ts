import { z } from "zod";
import { decimalStringSchema, objectIdSchema } from "./common-validator";

export const forecastRequestSchema = z
  .object({
    productId: objectIdSchema,
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    horizonDays: z.number().int().min(1).max(30).default(7),
    rollingWindowDays: z.number().int().min(1).max(90).default(7),
  })
  .strict()
  .superRefine((request, context) => {
    const start = new Date(`${request.startDate}T00:00:00.000Z`);
    const end = new Date(`${request.endDate}T00:00:00.000Z`);
    const days = (end.getTime() - start.getTime()) / 86_400_000 + 1;
    if (days < 1 || days > 366) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "Date range must be ordered and no longer than 366 days.",
      });
    }
  });

const forecastPointSchema = z
  .object({
    date: z.iso.date(),
    predictedUnits: decimalStringSchema,
    previousWeekUnits: decimalStringSchema.nullable().optional(),
  })
  .strict();

export const forecastResponseSchema = z
  .object({
    storeId: objectIdSchema,
    productId: objectIdSchema,
    unit: z.string(),
    status: z.enum(["ok", "insufficient_history", "zero_demand"]),
    method: z.string(),
    horizonDays: z.number().int().min(1).max(30),
    minimumHistoryDays: z.number().int(),
    observedHistoryDays: z.number().int(),
    historyThrough: z.iso.date(),
    forecasts: z.array(forecastPointSchema),
    comparison: z.string(),
    limitations: z.array(z.string()),
  })
  .strict();
