import { z } from "zod";
import { decimalStringSchema, objectIdSchema, paginationSchema } from "./common-validator";

const dateSchema = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

export const productIdSchema = objectIdSchema;

export const inventoryListQuerySchema = paginationSchema.strict();

export const receiveBatchSchema = z
  .object({
    batchNumber: z.string().trim().min(1).max(100),
    quantity: decimalStringSchema.refine(
      (value) => /[1-9]/.test(value.replace(".", "")),
      "Quantity must be greater than zero.",
    ),
    unitCost: decimalStringSchema,
    receivedDate: dateSchema.optional(),
    expiryDate: dateSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.receivedDate === undefined ||
      value.expiryDate === undefined ||
      new Date(value.expiryDate).getTime() >= new Date(value.receivedDate).getTime(),
    {
      message: "Expiry date must be on or after the received date.",
      path: ["expiryDate"],
    },
  );
