import { z } from "zod";
import { decimalStringSchema, paginationSchema } from "./common-validator";

const productFields = {
  name: z.string().trim().min(1).max(160),
  sku: z.string().trim().min(1).max(80),
  barcode: z.string().trim().min(1).max(80).optional(),
  category: z.string().trim().min(1).max(100),
  baseUnit: z.string().trim().min(1).max(40),
  sellingPrice: decimalStringSchema,
};

export const createProductSchema = z.object(productFields).strict();
export const updateProductSchema = z.object(productFields).partial().strict().refine(
  (value) => Object.keys(value).length > 0,
  "Provide at least one product field to update.",
);

export const productListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  isActive: z.enum(["true", "false"]).optional().transform((value) => {
    if (value === undefined) return undefined;
    return value === "true";
  }),
}).strict();
