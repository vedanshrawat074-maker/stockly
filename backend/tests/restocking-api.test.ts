import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getRestockingRecommendations: vi.fn() }));
vi.mock("../src/services/restocking-service", () => ({
  getRestockingRecommendations: mocks.getRestockingRecommendations,
}));

import request from "supertest";
import session from "express-session";
import { createApp } from "../src/app";

const storeId = "64b000000000000000000001";
const app = createApp({
  nodeEnv: "development",
  mlServiceUrl: "http://127.0.0.1:8000",
  mlServiceTimeoutMs: 2000,
  restockingPlanningHorizonDays: 7,
  restockingSafetyBufferDays: 2,
});
const productionApp = createApp({
  nodeEnv: "production",
  sessionSecret: "unit-test-session-secret-with-at-least-32-chars",
  sessionStore: new session.MemoryStore(),
});

describe("restocking recommendations API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRestockingRecommendations.mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 20, totalItems: 0, totalPages: 0 },
    });
  });

  it("uses the current store context and validated pagination", async () => {
    const response = await request(app)
      .get("/api/restocking/recommendations?page=2&limit=5")
      .set("X-Store-Id", storeId);

    expect(response.status).toBe(200);
    expect(mocks.getRestockingRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({ toHexString: expect.any(Function) }),
      { page: 2, limit: 5 },
      {
        mlServiceUrl: "http://127.0.0.1:8000",
        mlServiceTimeoutMs: 2000,
        planningHorizonDays: 7,
        safetyBufferDays: 2,
      },
    );
    expect(mocks.getRestockingRecommendations.mock.calls[0][0].toHexString()).toBe(storeId);
  });

  it("rejects malformed, unauthorized, or unsupported query fields", async () => {
    const responses = await Promise.all([
      request(app).get("/api/restocking/recommendations?productId=bad").set("X-Store-Id", storeId),
      request(app).get("/api/restocking/recommendations?limit=21").set("X-Store-Id", storeId),
      request(app).get("/api/restocking/recommendations?storeId=64b000000000000000000099").set("X-Store-Id", storeId),
      request(productionApp).get("/api/restocking/recommendations").set("X-Store-Id", storeId),
    ]);

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 401]);
    expect(mocks.getRestockingRecommendations).not.toHaveBeenCalled();
  });
});
