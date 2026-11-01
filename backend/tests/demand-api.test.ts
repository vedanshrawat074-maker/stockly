import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMock = vi.hoisted(() => ({ getDailyDemandHistory: vi.fn() }));
vi.mock("../src/services/demand-history-service", () => serviceMock);

import request from "supertest";
import session from "express-session";
import { createApp } from "../src/app";

const storeId = "64b000000000000000000001";
const productId = "64b000000000000000000002";
const app = createApp({ nodeEnv: "development" });

describe("demand history API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the product daily-demand forecast data contract", async () => {
    serviceMock.getDailyDemandHistory.mockResolvedValue({
      data: [{
        storeId,
        productId,
        unit: "each",
        availability: null,
        dailyDemand: [{ date: "2026-10-27", unitsSold: "0.5" }],
      }],
      period: { startDate: "2026-10-27", endDate: "2026-10-27", timezone: "UTC" },
      pagination: { page: 1, limit: 50, totalItems: 1, totalPages: 1 },
    });

    const response = await request(app)
      .get(`/api/demand/history?productId=${productId}&startDate=2026-10-27&endDate=2026-10-27`)
      .set("X-Store-Id", storeId);

    expect(response.status).toBe(200);
    expect(response.body.data[0].dailyDemand).toEqual([{ date: "2026-10-27", unitsSold: "0.5" }]);
    expect(response.body.data[0].availability).toBeNull();
    const [receivedStoreId, query] = serviceMock.getDailyDemandHistory.mock.calls[0];
    expect(receivedStoreId.toHexString()).toBe(storeId);
    expect(query).toEqual({
      startDate: "2026-10-27",
      endDate: "2026-10-27",
      productId,
      page: 1,
      limit: 50,
    });
  });

  it("rejects malformed, oversized, inverted or unknown query parameters", async () => {
    const headers = { "X-Store-Id": storeId };
    const invalid = await Promise.all([
      request(app).get("/api/demand/history?startDate=2026-02-30&endDate=2026-03-01").set(headers),
      request(app).get("/api/demand/history?startDate=2026-03-02&endDate=2026-03-01").set(headers),
      request(app).get("/api/demand/history?startDate=2025-01-01&endDate=2026-01-02").set(headers),
      request(app).get(`/api/demand/history?productId=bad&startDate=2026-03-01&endDate=2026-03-02`).set(headers),
      request(app).get("/api/demand/history?startDate=2026-03-01&endDate=2026-03-02&surprise=true").set(headers),
      request(app).get("/api/demand/history?startDate=2026-03-01&endDate=2026-03-02&limit=101").set(headers),
    ]);

    expect(invalid.map((response) => response.status)).toEqual([400, 400, 400, 400, 400, 400]);
    expect(serviceMock.getDailyDemandHistory).not.toHaveBeenCalled();
  });

  it("requires a development store context and disables it outside development", async () => {
    const missing = await request(app)
      .get("/api/demand/history?startDate=2026-03-01&endDate=2026-03-02");
    const production = await request(createApp({
      nodeEnv: "production",
      sessionSecret: "unit-test-session-secret-with-at-least-32-chars",
      sessionStore: new session.MemoryStore(),
    }))
      .get("/api/demand/history?startDate=2026-03-01&endDate=2026-03-02")
      .set("X-Store-Id", storeId);

    expect(missing.status).toBe(400);
    expect(production.status).toBe(401);
    expect(serviceMock.getDailyDemandHistory).not.toHaveBeenCalled();
  });
});
