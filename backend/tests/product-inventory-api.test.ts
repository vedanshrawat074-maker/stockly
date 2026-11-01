import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  createProduct: vi.fn(),
  deleteProduct: vi.fn(),
  getProduct: vi.fn(),
  listProducts: vi.fn(),
  updateProduct: vi.fn(),
  getInventoryForProduct: vi.fn(),
  listBatches: vi.fn(),
  listInventory: vi.fn(),
  receiveBatch: vi.fn(),
}));

vi.mock("../src/services/product-service", () => ({
  createProduct: serviceMocks.createProduct,
  deleteProduct: serviceMocks.deleteProduct,
  getProduct: serviceMocks.getProduct,
  listProducts: serviceMocks.listProducts,
  updateProduct: serviceMocks.updateProduct,
}));

vi.mock("../src/services/inventory-service", () => ({
  getInventoryForProduct: serviceMocks.getInventoryForProduct,
  listBatches: serviceMocks.listBatches,
  listInventory: serviceMocks.listInventory,
  receiveBatch: serviceMocks.receiveBatch,
}));

import request from "supertest";
import session from "express-session";
import { createApp } from "../src/app";
import { ApiError } from "../src/utils/api-error";

const storeId = "64b000000000000000000001";
const productId = "64b000000000000000000002";
const app = createApp({ nodeEnv: "development" });

function scopedRequest(method: "get" | "post" | "patch" | "delete", path: string) {
  return request(app)[method](path).set("X-Store-Id", storeId);
}

describe("product and inventory APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a product in the development store context and preserves decimal strings", async () => {
    serviceMocks.createProduct.mockResolvedValue({
      _id: productId,
      sku: "MILK-1",
      sellingPrice: "1.25",
    });

    const response = await scopedRequest("post", "/api/products").send({
      name: "Milk",
      sku: "milk-1",
      category: "Dairy",
      baseUnit: "litre",
      sellingPrice: "1.25",
    });

    expect(response.status).toBe(201);
    expect(response.body.data.sellingPrice).toBe("1.25");
    const [receivedStoreId, receivedInput] = serviceMocks.createProduct.mock.calls[0];
    expect(receivedStoreId.toHexString()).toBe(storeId);
    expect(receivedInput.sellingPrice).toBe("1.25");
  });

  it("maps duplicate product SKUs to HTTP 409", async () => {
    serviceMocks.createProduct.mockRejectedValue(Object.assign(new Error("duplicate key"), { code: 11000 }));

    const response = await scopedRequest("post", "/api/products").send({
      name: "Milk",
      sku: "MILK-1",
      category: "Dairy",
      baseUnit: "litre",
      sellingPrice: "1.25",
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("DUPLICATE_RESOURCE");
  });

  it("rejects unknown product fields and non-string monetary values", async () => {
    const unknownFieldResponse = await scopedRequest("post", "/api/products").send({
      name: "Milk",
      sku: "MILK-1",
      category: "Dairy",
      baseUnit: "litre",
      sellingPrice: "1.25",
      store: storeId,
    });
    const numericPriceResponse = await scopedRequest("post", "/api/products").send({
      name: "Milk",
      sku: "MILK-1",
      category: "Dairy",
      baseUnit: "litre",
      sellingPrice: 1.25,
    });

    expect(unknownFieldResponse.status).toBe(400);
    expect(numericPriceResponse.status).toBe(400);
    expect(serviceMocks.createProduct).not.toHaveBeenCalled();
  });

  it("validates pagination and malformed product IDs", async () => {
    const badPageResponse = await scopedRequest("get", "/api/products?page=0");
    const largeLimitResponse = await scopedRequest("get", "/api/products?limit=101");
    const badIdResponse = await scopedRequest("get", "/api/products/not-an-object-id");

    expect(badPageResponse.status).toBe(400);
    expect(largeLimitResponse.status).toBe(400);
    expect(badIdResponse.status).toBe(400);
    expect(serviceMocks.listProducts).not.toHaveBeenCalled();
    expect(serviceMocks.getProduct).not.toHaveBeenCalled();
  });

  it("returns 404 for a product absent from the requested store", async () => {
    serviceMocks.getProduct.mockRejectedValue(
      new ApiError(404, "PRODUCT_NOT_FOUND", "Product was not found."),
    );

    const response = await scopedRequest("get", `/api/products/${productId}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("PRODUCT_NOT_FOUND");
    const [receivedStoreId, receivedProductId] = serviceMocks.getProduct.mock.calls[0];
    expect(receivedStoreId.toHexString()).toBe(storeId);
    expect(receivedProductId.toHexString()).toBe(productId);
  });

  it("updates products and safely reports deletion actions", async () => {
    serviceMocks.updateProduct.mockResolvedValue({ _id: productId, name: "Whole Milk" });
    const updateResponse = await scopedRequest("patch", `/api/products/${productId}`).send({
      name: "Whole Milk",
    });

    serviceMocks.deleteProduct.mockResolvedValue({ id: productId, action: "deactivated" });
    const deleteResponse = await scopedRequest("delete", `/api/products/${productId}`);

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.name).toBe("Whole Milk");
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.data.action).toBe("deactivated");
  });

  it("returns paginated inventory with batch-derived fractional on-hand values", async () => {
    serviceMocks.listInventory.mockResolvedValue({
      data: [{ product: productId, onHandQuantity: "2.75" }],
      pagination: { page: 1, limit: 20, totalItems: 1, totalPages: 1 },
    });

    const response = await scopedRequest("get", "/api/inventory/?page=1&limit=20");

    expect(response.status).toBe(200);
    expect(response.body.data[0].onHandQuantity).toBe("2.75");
    const [receivedStoreId, page, limit] = serviceMocks.listInventory.mock.calls[0];
    expect(receivedStoreId.toHexString()).toBe(storeId);
    expect([page, limit]).toEqual([1, 20]);
  });

  it("gets one store-scoped inventory record and its paginated batches", async () => {
    serviceMocks.getInventoryForProduct.mockResolvedValue({
      inventory: { product: productId },
      product: { _id: productId },
      onHandQuantity: "0.5",
    });
    const inventoryResponse = await scopedRequest(
      "get",
      `/api/inventory/${productId}`,
    );
    serviceMocks.listBatches.mockResolvedValue({
      data: [{ batchNumber: "B-001", remainingQuantity: "0.5" }],
      pagination: { page: 1, limit: 20, totalItems: 1, totalPages: 1 },
    });
    const batchesResponse = await scopedRequest(
      "get",
      `/api/inventory/${productId}/batches?page=1`,
    );

    expect(inventoryResponse.status).toBe(200);
    expect(inventoryResponse.body.data.onHandQuantity).toBe("0.5");
    expect(batchesResponse.status).toBe(200);
    expect(batchesResponse.body.data[0].remainingQuantity).toBe("0.5");
    expect(serviceMocks.listBatches.mock.calls[0][0].toHexString()).toBe(storeId);
    expect(serviceMocks.listBatches.mock.calls[0][1].toHexString()).toBe(productId);
  });

  it("rejects zero batch receipts but accepts fractional quantities", async () => {
    const baseBody = {
      batchNumber: "B-001",
      unitCost: "0.125",
      receivedDate: "2026-10-27T00:00:00.000Z",
    };

    const zeroResponse = await scopedRequest("post", `/api/inventory/${productId}/batches`).send({
      ...baseBody,
      quantity: "0",
    });
    serviceMocks.receiveBatch.mockResolvedValue({ batch: { batchNumber: "B-002" } });
    const fractionalResponse = await scopedRequest(
      "post",
      `/api/inventory/${productId}/batches`,
    )
      .set("Idempotency-Key", "receipt-002")
      .send({ ...baseBody, batchNumber: "B-002", quantity: "0.25" });

    expect(zeroResponse.status).toBe(400);
    expect(fractionalResponse.status).toBe(201);
    const [receivedStoreId, receivedProductId, receivedInput] = serviceMocks.receiveBatch.mock.calls[0];
    expect(receivedStoreId.toHexString()).toBe(storeId);
    expect(receivedProductId.toHexString()).toBe(productId);
    expect(receivedInput).toMatchObject({
      quantity: "0.25",
      unitCost: "0.125",
      idempotencyKey: "receipt-002",
    });
    expect(serviceMocks.receiveBatch).toHaveBeenCalledTimes(1);
  });

  it("rejects negative values and invalid dates before batch receiving", async () => {
    const negativeResponse = await scopedRequest("post", `/api/inventory/${productId}/batches`).send({
      batchNumber: "B-001",
      quantity: "-1",
      unitCost: "1",
    });
    const invalidDateResponse = await scopedRequest(
      "post",
      `/api/inventory/${productId}/batches`,
    ).send({
      batchNumber: "B-001",
      quantity: "1",
      unitCost: "1",
      expiryDate: "not-a-date",
    });

    expect(negativeResponse.status).toBe(400);
    expect(invalidDateResponse.status).toBe(400);
    expect(serviceMocks.receiveBatch).not.toHaveBeenCalled();
  });

  it("does not accept client-supplied stock totals or batch remaining quantities", async () => {
    const response = await scopedRequest("post", `/api/inventory/${productId}/batches`).send({
      batchNumber: "B-001",
      quantity: "1",
      unitCost: "1",
      remainingQuantity: "0",
      onHandQuantity: "1000",
    });

    expect(response.status).toBe(400);
    expect(serviceMocks.receiveBatch).not.toHaveBeenCalled();
  });

  it("maps duplicate batch numbers and transaction failures to explicit responses", async () => {
    serviceMocks.receiveBatch.mockRejectedValueOnce(
      Object.assign(new Error("duplicate key"), { code: 11000 }),
    );
    const duplicateResponse = await scopedRequest(
      "post",
      `/api/inventory/${productId}/batches`,
    ).send({ batchNumber: "B-001", quantity: "1", unitCost: "1" });

    serviceMocks.receiveBatch.mockRejectedValueOnce(
      new ApiError(
        503,
        "TRANSACTIONS_UNSUPPORTED",
        "This operation requires MongoDB transactions.",
      ),
    );
    const transactionResponse = await scopedRequest(
      "post",
      `/api/inventory/${productId}/batches`,
    ).send({ batchNumber: "B-002", quantity: "1", unitCost: "1" });

    expect(duplicateResponse.status).toBe(409);
    expect(duplicateResponse.body.error.code).toBe("DUPLICATE_RESOURCE");
    expect(transactionResponse.status).toBe(503);
    expect(transactionResponse.body.error.code).toBe("TRANSACTIONS_UNSUPPORTED");
  });

  it("requires authenticated store ownership outside development", async () => {
    const productionApp = createApp({
      nodeEnv: "production",
      sessionSecret: "unit-test-session-secret-with-at-least-32-chars",
      sessionStore: new session.MemoryStore(),
    });
    const response = await request(productionApp)
      .get("/api/products")
      .set("X-Store-Id", storeId);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTHENTICATION_REQUIRED");
    expect(serviceMocks.listProducts).not.toHaveBeenCalled();
  });

  it("rejects malformed development store context", async () => {
    const response = await request(app).get("/api/products").set("X-Store-Id", "not-an-id");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_STORE_CONTEXT");
  });
});
