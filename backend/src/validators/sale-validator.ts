import { z } from "zod";
import { decimalStringSchema, paginationSchema, objectIdSchema } from "./common-validator";

export const createSaleSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            productId: objectIdSchema,
            quantity: decimalStringSchema.refine(
              (quantity) => /[1-9]/.test(quantity.replace(".", "")),
              "Quantity must be greater than zero.",
            ),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((sale, context) => {
    const seenProducts = new Set<string>();
    sale.items.forEach((item, index) => {
      const productId = item.productId.toLowerCase();
      if (seenProducts.has(productId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "productId"],
          message: "Each product may appear only once in a sale.",
        });
      }
      seenProducts.add(productId);
    });
  });

export const salesListQuerySchema = paginationSchema.strict();

export const idempotencyKeySchema = z.string().trim().min(1).max(160);
