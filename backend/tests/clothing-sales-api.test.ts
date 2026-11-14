import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClothingExchange: vi.fn(),
  createClothingReturn: vi.fn(),
  createClothingSale: vi.fn(),
  getClothingAnalytics: vi.fn(),
  getClothingExchange: vi.fn(),
  getClothingReturn: vi.fn(),
  getClothingSale: vi.fn(),
  listClothingExchanges: vi.fn(),
  listClothingReturns: vi.fn(),
  listClothingSales: vi.fn(),
  findStoreById: vi.fn(),
}));

vi.mock("../src/services/clothing-sales-service", () => ({
  createClothingExchange: mocks.createClothingExchange,
  createClothingReturn: mocks.createClothingReturn,
  createClothingSale: mocks.createClothingSale,
  getClothingExchange: mocks.getClothingExchange,
  getClothingReturn: mocks.getClothingReturn,
  getClothingSale: mocks.getClothingSale,
  listClothingExchanges: mocks.listClothingExchanges,
  listClothingReturns: mocks.listClothingReturns,
  listClothingSales: mocks.listClothingSales,
}));

vi.mock("../src/services/clothing-analytics-service", () => ({
  getClothingAnalytics: mocks.getClothingAnalytics,
}));

vi.mock("../src/models/store", () => ({
  StoreModel: { findById: mocks.findStoreById },
  shopTypes: ["grocery", "clothing"],
}));

import request from "supertest";
import { createApp } from "../src/app";
import { ApiError } from "../src/utils/api-error";

const storeId = "64b000000000000000000001";
const saleId = "64b000000000000000000002";
const app = createApp({ nodeEnv: "development" });

function scopedRequest(method: "get" | "post", path: string) {
  return request(app)[method](path).set("X-Store-Id", storeId);
}

function setShopType(shopType: "grocery" | "clothing") {
  mocks.findStoreById.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue({ shopType }),
  });
}

describe("clothing sales, returns and exchanges API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setShopType("clothing");
  });

  it("creates variant sales with payment and idempotency metadata", async () => {
    mocks.createClothingSale.mockResolvedValue({
      record: { _id: saleId, businessType: "clothing", totalAmount: "9" },
      replayed: false,
    });

    const response = await scopedRequest("post", "/api/clothing/sales")
      .set("Idempotency-Key", "clothing-sale-1")
      .send({
        items: [{ variantId: saleId, quantity: "1", discountPerUnit: "1" }],
        paymentMethod: "cash",
      });

    expect(response.status).toBe(201);
    expect(response.body.data.totalAmount).toBe("9");
    expect(response.body.meta.idempotentReplay).toBe(false);
    expect(mocks.createClothingSale.mock.calls[0][1]).toMatchObject({
      paymentMethod: "cash",
      idempotencyKey: "clothing-sale-1",
    });
  });

  it("requires a key and rejects duplicate variants or invalid payment methods", async () => {
    const missingKey = await scopedRequest("post", "/api/clothing/sales").send({
      items: [{ variantId: saleId, quantity: "1" }],
      paymentMethod: "cash",
    });
    const duplicateVariant = await scopedRequest("post", "/api/clothing/sales")
      .set("Idempotency-Key", "bad-sale")
      .send({
        items: [
          { variantId: saleId, quantity: "1" },
          { variantId: saleId, quantity: "1" },
        ],
        paymentMethod: "cash",
      });
    const invalidPayment = await scopedRequest("post", "/api/clothing/sales")
      .set("Idempotency-Key", "bad-payment")
      .send({ items: [{ variantId: saleId, quantity: "1" }], paymentMethod: "card-number" });

    expect([missingKey.status, duplicateVariant.status, invalidPayment.status]).toEqual([400, 400, 400]);
    expect(mocks.createClothingSale).not.toHaveBeenCalled();
  });

  it("creates returns and exchanges and reports idempotent replays", async () => {
    mocks.createClothingReturn.mockResolvedValue({
      record: { _id: "return-1", refundAmount: "10" },
      replayed: true,
    });
    mocks.createClothingExchange.mockResolvedValue({
      record: { _id: "exchange-1", additionalPaymentAmount: "5" },
      replayed: false,
    });

    const returnResponse = await scopedRequest("post", "/api/clothing/returns")
      .set("Idempotency-Key", "return-1")
      .send({
        saleId,
        items: [{ saleLineIndex: 0, quantity: "1", condition: "saleable", reason: "Wrong size" }],
        refundPaymentMethod: "upi",
      });
    const exchangeResponse = await scopedRequest("post", "/api/clothing/exchanges")
      .set("Idempotency-Key", "exchange-1")
      .send({
        saleId,
        returnedItems: [{ saleLineIndex: 0, quantity: "1", condition: "saleable", reason: "Size change" }],
        replacementItems: [{ variantId: saleId, quantity: "1" }],
        paymentMethod: "cash",
      });

    expect(returnResponse.status).toBe(200);
    expect(returnResponse.body.meta.idempotentReplay).toBe(true);
    expect(exchangeResponse.status).toBe(201);
    expect(exchangeResponse.body.data.additionalPaymentAmount).toBe("5");
    expect(mocks.createClothingReturn.mock.calls[0][1].idempotencyKey).toBe("return-1");
    expect(mocks.createClothingExchange.mock.calls[0][1].idempotencyKey).toBe("exchange-1");
  });

  it("rejects malformed return lines and blocks clothing operations for grocery stores", async () => {
    const invalid = await scopedRequest("post", "/api/clothing/returns")
      .set("Idempotency-Key", "bad-return")
      .send({
        saleId,
        items: [{ saleLineIndex: -1, quantity: "0", condition: "used", reason: "" }],
        refundPaymentMethod: "cash",
      });
    setShopType("grocery");
    const blocked = await scopedRequest("get", `/api/clothing/sales/${saleId}`);

    expect(invalid.status).toBe(400);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("SHOP_TYPE_NOT_SUPPORTED");
    expect(mocks.createClothingReturn).not.toHaveBeenCalled();
    expect(mocks.getClothingSale).not.toHaveBeenCalled();
  });

  it("keeps sale lookups store-scoped and rejects unauthenticated production requests", async () => {
    mocks.getClothingSale.mockRejectedValue(
      new ApiError(404, "SALE_NOT_FOUND", "Clothing sale was not found in this store."),
    );
    const missingSale = await scopedRequest("get", `/api/clothing/sales/${saleId}`);
    const protectedApp = createApp({ nodeEnv: "test" });
    const unauthorized = await request(protectedApp).get(`/api/clothing/sales/${saleId}`);

    expect(missingSale.status).toBe(404);
    expect(mocks.getClothingSale.mock.calls[0][0].toHexString()).toBe(storeId);
    expect(unauthorized.status).toBe(401);
  });

  it("validates the analytics date range and scopes queries to the selected store", async () => {
    const analytics = { revenue: { grossSales: "125.50", netRevenue: "115.50" } };
    mocks.getClothingAnalytics.mockResolvedValue(analytics);

    const response = await scopedRequest("get", "/api/clothing/analytics?startDate=2026-10-01&endDate=2026-10-03");
    const invalidRange = await scopedRequest(
      "get",
      "/api/clothing/analytics?startDate=2026-10-04&endDate=2026-10-01",
    );
    setShopType("grocery");
    const groceryStore = await scopedRequest(
      "get",
      "/api/clothing/analytics?startDate=2026-10-01&endDate=2026-10-03",
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(analytics);
    expect(mocks.getClothingAnalytics.mock.calls[0][0].toHexString()).toBe(storeId);
    expect(mocks.getClothingAnalytics.mock.calls[0][1]).toEqual({
      startDate: "2026-10-01",
      endDate: "2026-10-03",
    });
    expect(invalidRange.status).toBe(400);
    expect(groceryStore.status).toBe(403);
    expect(mocks.getClothingAnalytics).toHaveBeenCalledTimes(1);
  });
});
