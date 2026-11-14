import { z } from "zod";
import { paymentMethods } from "../models/sale";
import { decimalStringSchema, objectIdSchema, paginationSchema } from "./common-validator";
import { returnConditions } from "../models/clothing-return";

const positiveQuantitySchema = decimalStringSchema.refine(
  (value) => /[1-9]/.test(value.replace(".", "")),
  "Quantity must be greater than zero.",
);

const saleLineSchema = z.object({
  variantId: objectIdSchema,
  quantity: positiveQuantitySchema,
  unitPrice: decimalStringSchema.optional(),
  discountPerUnit: decimalStringSchema.optional(),
}).strict();

export const createClothingSaleSchema = z.object({
  items: z.array(saleLineSchema).min(1).max(100),
  paymentMethod: z.enum(paymentMethods),
}).strict().superRefine((sale, context) => {
  const seenVariants = new Set<string>();
  sale.items.forEach((item, index) => {
    const variantId = item.variantId.toLowerCase();
    if (seenVariants.has(variantId)) {
      context.addIssue({
        code: "custom",
        path: ["items", index, "variantId"],
        message: "Each clothing variant may appear only once in a sale.",
      });
    }
    seenVariants.add(variantId);
  });
});

const returnedLineSchema = z.object({
  saleLineIndex: z.number().int().min(0).max(99),
  quantity: positiveQuantitySchema,
  condition: z.enum(returnConditions),
  reason: z.string().trim().min(1).max(200),
}).strict();

export const createClothingReturnSchema = z.object({
  saleId: objectIdSchema,
  items: z.array(returnedLineSchema).min(1).max(100),
  refundPaymentMethod: z.enum(paymentMethods),
}).strict().superRefine((input, context) => {
  const seenLines = new Set<number>();
  input.items.forEach((item, index) => {
    if (seenLines.has(item.saleLineIndex)) {
      context.addIssue({
        code: "custom",
        path: ["items", index, "saleLineIndex"],
        message: "Each original sale line may appear only once in a return.",
      });
    }
    seenLines.add(item.saleLineIndex);
  });
});

const replacementLineSchema = z.object({
  variantId: objectIdSchema,
  quantity: positiveQuantitySchema,
  unitPrice: decimalStringSchema.optional(),
  discountPerUnit: decimalStringSchema.optional(),
}).strict();

export const createClothingExchangeSchema = z.object({
  saleId: objectIdSchema,
  returnedItems: z.array(returnedLineSchema).min(1).max(100),
  replacementItems: z.array(replacementLineSchema).min(1).max(100),
  paymentMethod: z.enum(paymentMethods).optional(),
  refundPaymentMethod: z.enum(paymentMethods).optional(),
}).strict().superRefine((input, context) => {
  const returnedLines = new Set<number>();
  input.returnedItems.forEach((item, index) => {
    if (returnedLines.has(item.saleLineIndex)) {
      context.addIssue({
        code: "custom",
        path: ["returnedItems", index, "saleLineIndex"],
        message: "Each original sale line may appear only once in an exchange.",
      });
    }
    returnedLines.add(item.saleLineIndex);
  });

  const replacementVariants = new Set<string>();
  input.replacementItems.forEach((item, index) => {
    const variantId = item.variantId.toLowerCase();
    if (replacementVariants.has(variantId)) {
      context.addIssue({
        code: "custom",
        path: ["replacementItems", index, "variantId"],
        message: "Each replacement variant may appear only once in an exchange.",
      });
    }
    replacementVariants.add(variantId);
  });
});

export const clothingTransactionsListQuerySchema = paginationSchema.extend({
  saleId: objectIdSchema.optional(),
}).strict();
