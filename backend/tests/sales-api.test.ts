import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  createSale: vi.fn(),
  listSales: vi.fn(),
}));

vi.mock("../src/services/sale-service", () => serviceMocks);

import request from "supertest";
import { createApp } from "../src/app";

const storeId = "64b000000000000000000001";
const productId = "64b000000000000000000002";
const app = createApp({ nodeEnv: "development" });

describe("sales API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a sale with a required idempotency key and reports replay status", async () => {
    serviceMocks.createSale.mockResolvedValue({
      sale: { saleIdentifier: "sale-1", totalAmount: "2.50" },
      replayed: false,
    });

    const response = await request(app)
      .post("/api/sales/")
      .set("X-Store-Id", storeId)
      .set("Idempotency-Key", "sale-request-1")
      .send({ items: [{ productId, quantity: "2.5" }] });

    expect(response.status).toBe(201);
    expect(response.body.data.totalAmount).toBe("2.50");
    expect(response.body.meta.idempotentReplay).toBe(false);
    const [receivedStoreId, input] = serviceMocks.createSale.mock.calls[0];
    expect(receivedStoreId.toHexString()).toBe(storeId);
    expect(input).toEqual({
      items: [{ productId, quantity: "2.5" }],
      idempotencyKey: "sale-request-1",
    });
  });

  it("returns HTTP 200 on an idempotent replay", async () => {
    serviceMocks.createSale.mockResolvedValue({
      sale: { saleIdentifier: "sale-1" },
      replayed: true,
    });

    const response = await request(app)
      .post("/api/sales")
      .set("X-Store-Id", storeId)
      .set("Idempotency-Key", "sale-request-1")
      .send({ items: [{ productId, quantity: "1" }] });

    expect(response.status).toBe(200);
    expect(response.body.meta.idempotentReplay).toBe(true);
  });

  it("rejects missing keys, invalid identifiers, zero or negative quantities, and unknown fields", async () => {
    const missingKey = await request(app)
      .post("/api/sales")
      .set("X-Store-Id", storeId)
      .send({ items: [{ productId, quantity: "1" }] });
    const invalidId = await request(app)
      .post("/api/sales")
      .set("X-Store-Id", storeId)
      .set("Idempotency-Key", "key")
      .send({ items: [{ productId: "bad-id", quantity: "1" }] });
    const invalidQuantity = await request(app)
      .post("/api/sales")
      .set("X-Store-Id", storeId)
      .set("Idempotency-Key", "key")
      .send({ items: [{ productId, quantity: "0" }] });
    const extraPrice = await request(app)
      .post("/api/sales")
      .set("X-Store-Id", storeId)
      .set("Idempotency-Key", "key")
      .send({ items: [{ productId, quantity: "1", unitPrice: "0.01" }] });

    expect([missingKey.status, invalidId.status, invalidQuantity.status, extraPrice.status]).toEqual([
      400, 400, 400, 400,
    ]);
    expect(serviceMocks.createSale).not.toHaveBeenCalled();
  });

  it("lists sales with validated pagination and store scope", async () => {
    serviceMocks.listSales.mockResolvedValue({
      data: [{ saleIdentifier: "sale-1" }],
      pagination: { page: 2, limit: 5, totalItems: 6, totalPages: 2 },
    });

    const response = await request(app)
      .get("/api/sales/?page=2&limit=5")
      .set("X-Store-Id", storeId);

    expect(response.status).toBe(200);
    expect(response.body.data[0].saleIdentifier).toBe("sale-1");
    const [receivedStoreId, query] = serviceMocks.listSales.mock.calls[0];
    expect(receivedStoreId.toHexString()).toBe(storeId);
    expect(query).toEqual({ page: 2, limit: 5 });
  });
});
