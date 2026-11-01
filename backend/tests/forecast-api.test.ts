import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDailyDemandHistory: vi.fn() }));
vi.mock("../src/services/demand-history-service", () => ({
  getDailyDemandHistory: mocks.getDailyDemandHistory,
}));

import request from "supertest";
import session from "express-session";
import { Types } from "mongoose";
import { createApp } from "../src/app";
import { requestForecast } from "../src/services/forecast-service";

const storeId = "64b000000000000000000001";
const productId = "64b000000000000000000002";
const app = createApp({
  nodeEnv: "development",
  mlServiceUrl: "http://ml.local",
  mlServiceTimeoutMs: 200,
});
const productionApp = createApp({
  nodeEnv: "production",
  sessionSecret: "unit-test-session-secret-with-at-least-32-chars",
  sessionStore: new session.MemoryStore(),
  mlServiceUrl: "http://ml.local",
  mlServiceTimeoutMs: 200,
});

const demandHistory = {
  data: [{
    storeId,
    productId,
    productName: "Rice",
    sku: "RICE",
    unit: "kg",
    isActive: true,
    availability: null,
    availabilityNote: "Historical availability unknown.",
    dailyDemand: [{ date: "2026-01-01", unitsSold: "0.5" }],
  }],
  period: { startDate: "2026-01-01", endDate: "2026-01-01", timezone: "UTC" },
  pagination: { page: 1, limit: 1, totalItems: 1, totalPages: 1 },
};

const forecastBody = {
  storeId,
  productId,
  unit: "kg",
  status: "ok",
  method: "rolling_average_7d",
  horizonDays: 7,
  minimumHistoryDays: 14,
  observedHistoryDays: 30,
  historyThrough: "2026-01-30",
  forecasts: Array.from({ length: 7 }, (_, index) => ({
    date: `2026-02-${String(index + 1).padStart(2, "0")}`,
    predictedUnits: "0.5",
    previousWeekUnits: null,
  })),
  comparison: "Previous week is a comparator.",
  limitations: ["Historical availability is unknown."],
};

describe("forecast integration API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDailyDemandHistory.mockResolvedValue(demandHistory);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(forecastBody), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uses scoped backend history and returns a validated forecast", async () => {
    const response = await request(app)
      .post("/api/forecasts")
      .set("X-Store-Id", storeId)
      .send({
        productId,
        startDate: "2026-01-01",
        endDate: "2026-01-30",
      });

    expect(response.status).toBe(200);
    expect(response.body.data.forecasts[0].predictedUnits).toBe("0.5");
    expect(mocks.getDailyDemandHistory.mock.calls[0][0].toHexString()).toBe(storeId);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toMatchObject({
      history: {
        storeId,
        productId,
        unit: "kg",
        availability: null,
        availabilityNote: "Historical availability unknown.",
        dailyDemand: demandHistory.data[0].dailyDemand,
      },
      horizonDays: 7,
    });
  });

  it("rejects invalid date ranges, IDs, extra fields, and client store IDs", async () => {
    const responses = await Promise.all([
      request(app).post("/api/forecasts").set("X-Store-Id", storeId).send({
        productId,
        startDate: "2026-01-02",
        endDate: "2026-01-01",
      }),
      request(app).post("/api/forecasts").set("X-Store-Id", storeId).send({
        productId: "bad",
        startDate: "2026-01-01",
        endDate: "2026-01-02",
      }),
      request(app).post("/api/forecasts").set("X-Store-Id", storeId).send({
        productId,
        storeId: "64b000000000000000000099",
        startDate: "2026-01-01",
        endDate: "2026-01-02",
      }),
      request(app).post("/api/forecasts").set("X-Store-Id", storeId).send({
        productId,
        startDate: "2026-01-01",
        endDate: "2026-01-02",
        minimumHistoryDays: 2,
      }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400]);
    expect(mocks.getDailyDemandHistory).not.toHaveBeenCalled();
  });

  it("does not enable the development store-header convention in production", async () => {
    const response = await request(productionApp)
      .post("/api/forecasts")
      .set("X-Store-Id", storeId)
      .send({
        productId,
        startDate: "2026-01-01",
        endDate: "2026-01-30",
      });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTHENTICATION_REQUIRED");
    expect(mocks.getDailyDemandHistory).not.toHaveBeenCalled();
  });

  it("maps timeout, unavailable service, and malformed responses without leaking details", async () => {
    const input = {
      productId,
      startDate: "2026-01-01",
      endDate: "2026-01-30",
      horizonDays: 7,
      rollingWindowDays: 7,
    };
    vi.mocked(fetch).mockRejectedValueOnce(new Error("secret internal detail"));
    await expect(
      requestForecast(new Types.ObjectId(storeId), input, {
        url: "http://ml.local",
        timeoutMs: 200,
      }),
    ).rejects.toMatchObject({ statusCode: 503, code: "FORECAST_SERVICE_UNAVAILABLE" });

    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await expect(
      requestForecast(new Types.ObjectId(storeId), input, {
        url: "http://ml.local",
        timeoutMs: 200,
      }),
    ).rejects.toMatchObject({ statusCode: 502, code: "INVALID_FORECAST_RESPONSE" });

    vi.mocked(fetch).mockResolvedValueOnce(new Response("internal details", { status: 503 }));
    await expect(
      requestForecast(new Types.ObjectId(storeId), input, {
        url: "http://ml.local",
        timeoutMs: 200,
      }),
    ).rejects.toMatchObject({ statusCode: 502, code: "FORECAST_SERVICE_UNAVAILABLE" });

    vi.mocked(fetch).mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    await expect(
      requestForecast(new Types.ObjectId(storeId), input, {
        url: "http://ml.local",
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ statusCode: 504, code: "FORECAST_SERVICE_TIMEOUT" });
  });

  it("rejects invalid forecast service identity", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ...forecastBody, productId: "64b000000000000000000099" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      requestForecast(new Types.ObjectId(storeId), {
        productId,
        startDate: "2026-01-01",
        endDate: "2026-01-30",
        horizonDays: 7,
        rollingWindowDays: 7,
      }, { url: "http://ml.local", timeoutMs: 200 }),
    ).rejects.toMatchObject({ statusCode: 502, code: "INVALID_FORECAST_RESPONSE" });
  });
});
