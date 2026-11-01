import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env";

describe("environment configuration", () => {
  it("parses validated settings and comma-separated CORS origins", () => {
    expect(
      loadConfig({
        NODE_ENV: "test",
        PORT: "4100",
        MONGODB_URI: "mongodb://localhost:27017/stockly",
        SESSION_SECRET: "test-session-secret-at-least-32-characters",
        CORS_ORIGIN: "http://localhost:3000, https://stockly.example",
      }),
    ).toEqual({
      nodeEnv: "test",
      port: 4100,
      mongodbUri: "mongodb://localhost:27017/stockly",
      sessionSecret: "test-session-secret-at-least-32-characters",
      sessionCookieSecure: false,
      sessionCookieSameSite: "lax",
      mlServiceUrl: "http://127.0.0.1:8000",
      mlServiceTimeoutMs: 5000,
      restockingPlanningHorizonDays: 7,
      restockingSafetyBufferDays: 2,
      corsOrigins: ["http://localhost:3000", "https://stockly.example"],
    });
  });

  it("rejects invalid environment values with a useful startup error", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        PORT: "not-a-port",
        MONGODB_URI: "not-a-mongodb-uri",
        SESSION_SECRET: "test-session-secret-at-least-32-characters",
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  it("rejects a restocking forecast range that exceeds the ML service limit", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        MONGODB_URI: "mongodb://localhost:27017/stockly",
        SESSION_SECRET: "test-session-secret-at-least-32-characters",
        RESTOCKING_PLANNING_HORIZON_DAYS: "29",
        RESTOCKING_SAFETY_BUFFER_DAYS: "2",
      }),
    ).toThrow(/forecast limit/);
  });

  it("requires secure cookies in production and for SameSite=None", () => {
    expect(() => loadConfig({
      NODE_ENV: "production",
      MONGODB_URI: "mongodb://localhost:27017/stockly",
      SESSION_SECRET: "production-session-secret-at-least-32-characters",
    })).toThrow(/SESSION_COOKIE_SECURE=true/);

    expect(() => loadConfig({
      NODE_ENV: "development",
      MONGODB_URI: "mongodb://localhost:27017/stockly",
      SESSION_SECRET: "development-session-secret-at-least-32-characters",
      SESSION_COOKIE_SAME_SITE: "none",
    })).toThrow(/SameSite=None requires/);
  });
});
