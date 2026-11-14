import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  adjustClothingVariantStock: vi.fn(),
  createClothingProduct: vi.fn(),
  createClothingVariant: vi.fn(),
  listClothingVariants: vi.fn(),
  updateClothingVariant: vi.fn(),
  findStoreById: vi.fn(),
}));

vi.mock("../src/services/clothing-service", () => ({
  adjustClothingVariantStock: serviceMocks.adjustClothingVariantStock,
  createClothingProduct: serviceMocks.createClothingProduct,
  createClothingVariant: serviceMocks.createClothingVariant,
  listClothingVariants: serviceMocks.listClothingVariants,
  updateClothingVariant: serviceMocks.updateClothingVariant,
}));

vi.mock("../src/models/store", () => ({
  StoreModel: { findById: serviceMocks.findStoreById },
  shopTypes: ["grocery", "clothing"],
}));

import request from "supertest";
import { createApp } from "../src/app";
import { ApiError } from "../src/utils/api-error";

const storeId = "64b000000000000000000001";
const productId = "64b000000000000000000002";
const variantId = "64b000000000000000000003";
const app = createApp({ nodeEnv: "development" });

function scopedRequest(method: "get" | "post" | "patch", path: string) {
  return request(app)[method](path).set("X-Store-Id", storeId);
}

function setShopType(shopType: "grocery" | "clothing") {
  const query = {
    select: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue({ shopType }),
  };
  serviceMocks.findStoreById.mockReturnValue(query);
}

describe("clothing inventory API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setShopType("clothing");
  });

  it("creates a clothing product with multiple variants in the authorized store", async () => {
    serviceMocks.createClothingProduct.mockResolvedValue({
      product: { _id: productId, category: "Men" },
      variants: [{ _id: variantId, size: "M", colour: "navy", stockQuantity: "4" }],
    });

    const response = await scopedRequest("post", "/api/clothing/products").send({
      name: "Shirt",
      sku: "SHIRT-1",
      category: "Men",
      sellingPrice: "12.50",
      variants: [
        { size: "M", colour: "Navy", sku: "SHIRT-M-NV", stockQuantity: "4", lowStockThreshold: "1" },
        { size: "L", colour: "Navy", sku: "SHIRT-L-NV", stockQuantity: "2", lowStockThreshold: "1" },
      ],
    });

    expect(response.status).toBe(201);
    expect(serviceMocks.createClothingProduct.mock.calls[0][0].toHexString()).toBe(storeId);
    expect(serviceMocks.createClothingProduct.mock.calls[0][1].variants).toHaveLength(2);
  });

  it("rejects invalid categories and negative stock before calling services", async () => {
    const invalidCategory = await scopedRequest("post", "/api/clothing/products").send({
      name: "Shirt",
      sku: "SHIRT-1",
      category: "Grocery",
      sellingPrice: "12.50",
    });
    const invalidStock = await scopedRequest("post", `/api/clothing/products/${productId}/variants`).send({
      size: "M",
      colour: "Navy",
      sku: "SHIRT-M-NV",
      stockQuantity: "-1",
    });

    expect(invalidCategory.status).toBe(400);
    expect(invalidStock.status).toBe(400);
    expect(serviceMocks.createClothingProduct).not.toHaveBeenCalled();
    expect(serviceMocks.createClothingVariant).not.toHaveBeenCalled();
  });

  it("maps duplicate variants to a conflict response", async () => {
    serviceMocks.createClothingVariant.mockRejectedValue(
      Object.assign(new Error("duplicate key"), { code: 11000 }),
    );

    const response = await scopedRequest("post", `/api/clothing/products/${productId}/variants`).send({
      size: "M",
      colour: "Navy",
      sku: "SHIRT-M-NV",
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("DUPLICATE_RESOURCE");
  });

  it("blocks clothing operations for grocery shops", async () => {
    setShopType("grocery");
    const response = await scopedRequest("get", `/api/clothing/products/${productId}/variants`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("SHOP_TYPE_NOT_SUPPORTED");
    expect(serviceMocks.listClothingVariants).not.toHaveBeenCalled();
  });

  it("passes variant stock adjustments through the store-scoped API", async () => {
    serviceMocks.adjustClothingVariantStock.mockResolvedValue({
      _id: variantId,
      store: storeId,
      stockQuantity: "5",
    });

    const response = await scopedRequest("post", `/api/clothing/variants/${variantId}/adjustments`).send({
      quantityDelta: "-2",
      reason: "Damaged stock",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.stockQuantity).toBe("5");
    const [receivedStoreId, receivedVariantId, quantityDelta, reason] =
      serviceMocks.adjustClothingVariantStock.mock.calls[0];
    expect(receivedStoreId.toHexString()).toBe(storeId);
    expect(receivedVariantId.toHexString()).toBe(variantId);
    expect(quantityDelta).toBe("-2");
    expect(reason).toBe("Damaged stock");
  });

  it("returns not-found for variants unavailable in the active store and rejects malformed IDs", async () => {
    serviceMocks.updateClothingVariant.mockRejectedValue(
      new ApiError(404, "VARIANT_NOT_FOUND", "Clothing variant was not found."),
    );
    const missing = await scopedRequest("patch", `/api/clothing/variants/${variantId}`).send({
      lowStockThreshold: "3",
    });
    const malformed = await scopedRequest("get", "/api/clothing/products/not-an-id/variants");

    expect(missing.status).toBe(404);
    expect(malformed.status).toBe(400);
    expect(serviceMocks.listClothingVariants).not.toHaveBeenCalled();
  });
});
