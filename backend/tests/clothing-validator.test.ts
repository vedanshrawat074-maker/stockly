import { describe, expect, it } from "vitest";
import {
  adjustClothingStockSchema,
  createClothingProductSchema,
  createClothingVariantSchema,
} from "../src/validators/clothing-validator";

describe("clothing inventory validation", () => {
  it("accepts supported clothing categories and multiple nonnegative variant quantities", () => {
    const result = createClothingProductSchema.safeParse({
      name: "Everyday shirt",
      sku: "SHIRT-1",
      category: "Men",
      sellingPrice: "12.50",
      variants: [
        { size: "M", colour: "Navy", sku: "SHIRT-M-NV", stockQuantity: "4", lowStockThreshold: "1" },
        { size: "L", colour: "Navy", sku: "SHIRT-L-NV", stockQuantity: "2", lowStockThreshold: "1" },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.variants).toHaveLength(2);
  });

  it("rejects unsupported categories, negative quantities, and zero stock adjustments", () => {
    expect(createClothingProductSchema.safeParse({
      name: "Product",
      sku: "P-1",
      category: "Grocery",
      sellingPrice: "1",
    }).success).toBe(false);
    expect(createClothingVariantSchema.safeParse({
      size: "M",
      colour: "Blue",
      sku: "P-M-B",
      stockQuantity: "-1",
    }).success).toBe(false);
    expect(adjustClothingStockSchema.safeParse({ quantityDelta: "0", reason: "Correction" }).success).toBe(false);
    expect(adjustClothingStockSchema.safeParse({ quantityDelta: "00.000", reason: "Correction" }).success).toBe(false);
    expect(adjustClothingStockSchema.safeParse({ quantityDelta: "-0.5", reason: "Correction" }).success).toBe(true);
  });
});
