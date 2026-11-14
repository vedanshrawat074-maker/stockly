import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isClothingAnalyticsRoute, isClothingRestockingRoute } from "../src/lib/business-views.ts";

describe("business-specific analytics routing", () => {
  it("uses clothing analytics for clothing shops on dashboard and analytics routes", () => {
    assert.equal(isClothingAnalyticsRoute("clothing", "/dashboard"), true);
    assert.equal(isClothingAnalyticsRoute("clothing", "/analytics"), true);
  });

  it("preserves grocery analytics and clothing forecast behavior", () => {
    assert.equal(isClothingAnalyticsRoute("grocery", "/dashboard"), false);
    assert.equal(isClothingAnalyticsRoute("grocery", "/analytics"), false);
    assert.equal(isClothingAnalyticsRoute("clothing", "/forecasts"), false);
    assert.equal(isClothingAnalyticsRoute(undefined, "/dashboard"), false);
  });

  it("uses clothing restocking only for a persisted clothing shop type", () => {
    assert.equal(isClothingRestockingRoute("clothing"), true);
    assert.equal(isClothingRestockingRoute("grocery"), false);
    assert.equal(isClothingRestockingRoute(undefined), false);
  });
});
