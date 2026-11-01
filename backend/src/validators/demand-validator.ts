import { z } from "zod";
import { objectIdSchema } from "./common-validator";

const dateOnlySchema = z.iso.date();

export const demandHistoryQuerySchema = z
  .object({
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
    productId: objectIdSchema.optional(),
    page: z
      .string()
      .regex(/^[1-9]\d*$/)
      .refine((value) => Number.isSafeInteger(Number(value)), "Must be a safe integer.")
      .optional()
      .transform(Number)
      .default(1),
    limit: z
      .string()
      .regex(/^[1-9]\d*$/)
      .refine((value) => Number.isSafeInteger(Number(value)), "Must be a safe integer.")
      .optional()
      .transform(Number)
      .default(50),
  })
  .strict()
  .superRefine((query, context) => {
    const start = new Date(`${query.startDate}T00:00:00.000Z`);
    const end = new Date(`${query.endDate}T00:00:00.000Z`);
    const dayCount = (end.getTime() - start.getTime()) / 86_400_000 + 1;

    if (dayCount < 1) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "endDate must be on or after startDate.",
      });
    } else if (dayCount > 366) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "Date range must not exceed 366 calendar days.",
      });
    }

    if (query.limit > 100) {
      context.addIssue({
        code: "custom",
        path: ["limit"],
        message: "limit must not exceed 100.",
      });
    }
    if (!Number.isSafeInteger((query.page - 1) * query.limit)) {
      context.addIssue({
        code: "custom",
        path: ["page"],
        message: "Page and limit produce an unsafe pagination offset.",
      });
    }
  });
