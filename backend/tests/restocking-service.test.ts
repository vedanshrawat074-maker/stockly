import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { buildRestockingRecommendation } from "../src/services/restocking-service";
import { forecastResponseSchema } from "../src/validators/forecast-validator";

const product = {
  _id: new Types.ObjectId("64b000000000000000000001"),
  name: "Rice",
  baseUnit: "kg",
};

function forecast(values: string[], status: "ok" | "zero_demand" | "insufficient_history" = "ok") {
  return forecastResponseSchema.parse({
    storeId: "64b000000000000000000002",
    productId: product._id.toHexString(),
    unit: "kg",
    status,
    method: "rolling_average_7d",
    horizonDays: Math.max(values.length, 1),
    minimumHistoryDays: 14,
    observedHistoryDays: 30,
    historyThrough: "2026-10-26",
    forecasts: values.map((predictedUnits, index) => {
      const date = new Date(Date.UTC(2026, 9, 27 + index)).toISOString().slice(0, 10);
      return { date, predictedUnits, previousWeekUnits: null };
    }),
    comparison: "Comparator only.",
    limitations: ["Historical availability is unknown."],
  });
}

describe("restocking recommendation arithmetic", () => {
  it("uses disjoint planning and buffer periods without double-counting", () => {
    const result = buildRestockingRecommendation({
      product,
      usableStock: Types.Decimal128.fromString("0.25"),
      forecast: forecast(Array(9).fill("0.1")),
      planningHorizonDays: 7,
      safetyBufferDays: 2,
    });

    expect(result.forecastDemand).toBe("0.7");
    expect(result.safetyBuffer).toBe("0.2");
    expect(result.suggestedRestockQuantity).toBe("0.65");
    expect(result.reason).toContain("Target stock is 0.9 kg");
    expect(result.status).toBe("RESTOCK_RECOMMENDED");
  });

  it("does not recommend restocking when stock exactly covers the target", () => {
    const result = buildRestockingRecommendation({
      product,
      usableStock: Types.Decimal128.fromString("0.9"),
      forecast: forecast(Array(9).fill("0.1")),
      planningHorizonDays: 7,
      safetyBufferDays: 2,
    });

    expect(result.suggestedRestockQuantity).toBe("0");
    expect(result.status).toBe("NO_RESTOCK_NEEDED");
  });

  it("sums high-precision daily forecasts within Decimal128 range", () => {
    const dailyPrediction = "0.12345678901234567890123456789012";
    const result = buildRestockingRecommendation({
      product,
      usableStock: Types.Decimal128.fromString("0"),
      forecast: forecast(Array(30).fill(dailyPrediction)),
      planningHorizonDays: 30,
      safetyBufferDays: 0,
    });

    expect(result.forecastDemand).toBe("3.7037036703703703670370370367036");
    expect(result.suggestedRestockQuantity).toBe(result.forecastDemand);
  });

  it("keeps all-zero demand at zero and reports minimum stock as a separate fallback", () => {
    const noDemand = buildRestockingRecommendation({
      product,
      usableStock: Types.Decimal128.fromString("0"),
      forecast: forecast(Array(9).fill("0"), "zero_demand"),
      planningHorizonDays: 7,
      safetyBufferDays: 2,
    });
    expect(noDemand.status).toBe("NO_RESTOCK_NEEDED");
    expect(noDemand.suggestedRestockQuantity).toBe("0");
    expect(noDemand.lowStockFallback).toBeNull();

    const coldStart = buildRestockingRecommendation({
      product,
      usableStock: Types.Decimal128.fromString("0.5"),
      minimumStockThreshold: Types.Decimal128.fromString("1.0"),
      forecast: forecast([], "insufficient_history"),
      planningHorizonDays: 7,
      safetyBufferDays: 2,
    });
    expect(coldStart.status).toBe("INSUFFICIENT_HISTORY");
    expect(coldStart.suggestedRestockQuantity).toBeNull();
    expect(coldStart.lowStockFallback).toEqual({ threshold: "1.0", triggered: true });
    expect(coldStart.reason).toContain("Separately");
  });

  it("returns unavailable rather than an invented quantity when forecasting fails", () => {
    const result = buildRestockingRecommendation({
      product,
      usableStock: Types.Decimal128.fromString("0"),
      forecastFailure: "FORECAST_UNAVAILABLE",
      planningHorizonDays: 7,
      safetyBufferDays: 2,
    });

    expect(result.status).toBe("FORECAST_UNAVAILABLE");
    expect(result.forecastDemand).toBeNull();
    expect(result.safetyBuffer).toBeNull();
    expect(result.suggestedRestockQuantity).toBeNull();
  });
});
