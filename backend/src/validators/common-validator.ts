import { Types } from "mongoose";
import { z } from "zod";

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Must be a valid ObjectId.");

export const paginationSchema = z
  .object({
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
      .default(20),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.limit > 100) {
      context.addIssue({
        code: "custom",
        path: ["limit"],
        message: "Limit must not exceed 100.",
      });
    }
    if (!Number.isSafeInteger((value.page - 1) * value.limit)) {
      context.addIssue({
        code: "custom",
        path: ["page"],
        message: "Page and limit produce an unsafe pagination offset.",
      });
    }
  });

export const decimalStringSchema = z
  .string()
  .regex(/^\d+(?:\.\d+)?$/, "Must be a nonnegative decimal string.")
  .refine((value) => value.replace(".", "").length <= 34, "Must fit within Decimal128 precision.")
  .refine((value) => {
    try {
      Types.Decimal128.fromString(value);
      return true;
    } catch {
      return false;
    }
  }, "Must be a valid Decimal128 value.");
