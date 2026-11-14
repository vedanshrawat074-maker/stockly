import { Types } from "mongoose";
import { z } from "zod";
import { decimalStringSchema } from "./common-validator";

export const clothingCategories = ["Men", "Women", "Kids", "Accessories"] as const;

const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const skuSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/);

const createVariantSchema = z
  .object({
    size: text(40),
    colour: text(60),
    designIdentifier: text(80).optional(),
    sku: skuSchema,
    stockQuantity: decimalStringSchema.optional().default("0"),
    lowStockThreshold: decimalStringSchema.optional().default("0"),
  })
  .strict();

export const createClothingProductSchema = z
  .object({
    name: text(160),
    sku: skuSchema,
    barcode: z.string().trim().min(1).max(64).optional(),
    category: z.enum(clothingCategories),
    sellingPrice: decimalStringSchema,
    variants: z.array(createVariantSchema).max(200).default([]),
  })
  .strict();

export const createClothingVariantSchema = createVariantSchema;

export const updateClothingVariantSchema = z
  .object({
    size: text(40).optional(),
    colour: text(60).optional(),
    designIdentifier: text(80).optional(),
    sku: skuSchema.optional(),
    lowStockThreshold: decimalStringSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");

export const adjustClothingStockSchema = z
  .object({
    quantityDelta: z
      .string()
      .regex(/^-?\d+(?:\.\d+)?$/, "Must be a nonzero signed decimal string.")
      .refine((value) => value.replace(/[-.]/g, "").length <= 34, "Must fit within Decimal128 precision.")
      .refine((value) => !/^-?0+(?:\.0+)?$/.test(value), "Quantity adjustment must not be zero.")
      .refine((value) => {
        try {
          Types.Decimal128.fromString(value);
          return true;
        } catch {
          return false;
        }
      }, "Must be a valid Decimal128 value."),
    reason: text(200),
  })
  .strict();
