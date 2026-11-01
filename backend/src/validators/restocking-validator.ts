import { z } from "zod";
import { objectIdSchema } from "./common-validator";

const positiveIntegerQuery = (fallback: number) =>
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .refine((value) => Number.isSafeInteger(Number(value)), "Must be a safe integer.")
    .optional()
    .transform((value) => Number(value ?? fallback));

export const restockingQuerySchema = z
  .object({
    productId: objectIdSchema.optional(),
    page: positiveIntegerQuery(1),
    limit: positiveIntegerQuery(20),
  })
  .strict()
  .superRefine((query, context) => {
    if (query.limit > 20) {
      context.addIssue({
        code: "custom",
        path: ["limit"],
        message: "Limit must not exceed 20 for forecast-backed recommendations.",
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
