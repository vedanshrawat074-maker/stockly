import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { computeAlertConditions } from "../src/services/alert-generation-service";
import {
  addCalendarDays,
  compareCalendarDates,
  getExpiryDateOnly,
  getStoreLocalDate,
} from "../src/services/expiry-calendar";

const productId = new Types.ObjectId();
const threshold = Types.Decimal128.fromString("5");

function product(isActive = true) {
  return { _id: productId, name: "Apples", isActive };
}

function inventory(minimumStockThreshold = threshold) {
  return { product: productId, minimumStockThreshold };
}

function batch(
  quantity: string,
  expiryDate?: Date,
  _id = new Types.ObjectId(),
) {
  return {
    _id,
    product: productId,
    batchNumber: "LOT-1",
    remainingQuantity: Types.Decimal128.fromString(quantity),
    ...(expiryDate ? { expiryDate } : {}),
  };
}

function compute(options: {
  now?: Date;
  timezone?: string;
  warningDays?: number;
  active?: boolean;
  threshold?: Types.Decimal128;
  batches?: ReturnType<typeof batch>[];
}) {
  return computeAlertConditions(
    options.timezone ?? "America/Los_Angeles",
    options.active === false ? [product(false)] : [product()],
    [inventory(options.threshold ?? threshold)],
    options.batches ?? [],
    options.now ?? new Date("2026-10-27T18:00:00.000Z"),
    options.warningDays ?? 7,
  );
}

describe("expiry calendar and alert conditions", () => {
  it("uses the store-local calendar date across timezone offsets and DST", () => {
    const instant = new Date("2026-10-27T06:30:00.000Z");
    const localDate = getStoreLocalDate(instant, "America/Los_Angeles");
    expect(localDate).toEqual({ year: 2026, month: 10, day: 26 });
    expect(compareCalendarDates(addCalendarDays(localDate, 1), { year: 2026, month: 10, day: 27 })).toBe(0);
    expect(() => getStoreLocalDate(instant, "Not/A-Timezone")).toThrow(/timezone/i);
  });

  it("treats expiry yesterday as expired, today as warning, and tomorrow as warning", () => {
    const now = new Date("2026-10-27T18:00:00.000Z");
    const conditions = compute({
      now,
      batches: [
        batch("1", new Date("2026-10-26T00:00:00.000Z")),
        batch("1", new Date("2026-10-27T00:00:00.000Z")),
        batch("1", new Date("2026-10-28T00:00:00.000Z")),
      ],
    });

    expect(conditions.filter((condition) => condition.type !== "LOW_STOCK").map((condition) => condition.type).sort()).toEqual([
      "EXPIRED_STOCK",
      "EXPIRING_SOON",
      "EXPIRING_SOON",
    ]);
  });

  it("does not expire a date-only batch until the next store-local day", () => {
    const expiringAtEndOfLocalDay = compute({
      now: new Date("2026-10-27T06:30:00.000Z"),
      warningDays: 0,
      batches: [batch("1", new Date("2026-10-26T00:00:00.000Z"))],
    });
    const afterLocalMidnight = compute({
      now: new Date("2026-10-27T07:00:00.000Z"),
      warningDays: 0,
      batches: [batch("1", new Date("2026-10-26T00:00:00.000Z"))],
    });

    expect(expiringAtEndOfLocalDay.some((condition) => condition.type === "EXPIRED_STOCK")).toBe(false);
    expect(expiringAtEndOfLocalDay.some((condition) => condition.type === "EXPIRING_SOON")).toBe(true);
    expect(afterLocalMidnight.some((condition) => condition.type === "EXPIRED_STOCK")).toBe(true);
  });

  it("includes the warning-window boundary and excludes the next calendar day", () => {
    const conditions = compute({
      now: new Date("2026-10-27T18:00:00.000Z"),
      warningDays: 3,
      batches: [
        batch("1", new Date("2026-10-30T00:00:00.000Z")),
        batch("1", new Date("2026-10-31T00:00:00.000Z")),
      ],
    });

    expect(conditions.filter((condition) => condition.type === "EXPIRING_SOON")).toHaveLength(1);
    expect(conditions.find((condition) => condition.type === "EXPIRING_SOON")?.details).toContain(
      "2026-10-30",
    );
  });

  it("ignores batches with no expiry and zero remaining quantity", () => {
    const conditions = compute({
      batches: [batch("1"), batch("0", new Date("2026-10-27T00:00:00.000Z"))],
    });

    expect(conditions.filter((condition) => condition.type.includes("EXPIR"))).toHaveLength(0);
  });

  it("excludes expired stock from usable stock while alerting on expired positive stock", () => {
    const conditions = compute({
      batches: [
        batch("4", new Date("2026-10-26T00:00:00.000Z")),
        batch("4", new Date("2026-10-27T00:00:00.000Z")),
      ],
    });
    const lowStock = conditions.find((condition) => condition.type === "LOW_STOCK");

    expect(lowStock?.details).toContain("4");
    expect(conditions.filter((condition) => condition.type === "EXPIRED_STOCK")).toHaveLength(1);
  });

  it("alerts at threshold equality and below, but not for inactive products", () => {
    const equality = compute({ batches: [batch("5")] });
    const below = compute({ batches: [batch("4.999")] });
    const inactive = compute({ active: false, batches: [batch("0")] });

    expect(equality.find((condition) => condition.type === "LOW_STOCK")?.severity).toBe("MEDIUM");
    expect(below.find((condition) => condition.type === "LOW_STOCK")?.severity).toBe("HIGH");
    expect(inactive.some((condition) => condition.type === "LOW_STOCK")).toBe(false);
  });

  it("uses exact Decimal128-compatible sums without binary floating point", () => {
    const conditions = compute({
      threshold: Types.Decimal128.fromString("0.3"),
      batches: [batch("0.1"), batch("0.2")],
    });
    expect(conditions.some((condition) => condition.type === "LOW_STOCK")).toBe(true);
    expect(getExpiryDateOnly(new Date("2026-10-27T22:59:59.999Z"))).toEqual({
      year: 2026,
      month: 10,
      day: 27,
    });
  });
});
