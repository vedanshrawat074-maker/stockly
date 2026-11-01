import { beforeEach, describe, expect, it, vi } from "vitest";

const alertMocks = vi.hoisted(() => ({
  acknowledgeAlert: vi.fn(),
  generateStoreAlerts: vi.fn(),
  listAlerts: vi.fn(),
  resolveAlert: vi.fn(),
}));

vi.mock("../src/services/alert-service", () => ({
  acknowledgeAlert: alertMocks.acknowledgeAlert,
  listAlerts: alertMocks.listAlerts,
  resolveAlert: alertMocks.resolveAlert,
}));
vi.mock("../src/services/alert-generation-service", () => ({
  generateStoreAlerts: alertMocks.generateStoreAlerts,
}));

import request from "supertest";
import session from "express-session";
import { createApp } from "../src/app";
import { ApiError } from "../src/utils/api-error";

const storeId = "64b000000000000000000001";
const alertId = "64b000000000000000000002";
const app = createApp({ nodeEnv: "development" });

function scoped(method: "get" | "post" | "patch", path: string) {
  return request(app)[method](path).set("X-Store-Id", storeId);
}

describe("alerts API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists alerts with store scope, filters, and pagination", async () => {
    alertMocks.listAlerts.mockResolvedValue({
      data: [{ type: "LOW_STOCK", status: "ACTIVE" }],
      pagination: { page: 2, limit: 10, totalItems: 11, totalPages: 2 },
    });

    const response = await scoped("get", "/api/alerts/?page=2&limit=10&type=LOW_STOCK&status=ACTIVE");

    expect(response.status).toBe(200);
    expect(response.body.data[0].type).toBe("LOW_STOCK");
    const [receivedStoreId, query] = alertMocks.listAlerts.mock.calls[0];
    expect(receivedStoreId.toHexString()).toBe(storeId);
    expect(query).toEqual({ page: 2, limit: 10, type: "LOW_STOCK", status: "ACTIVE" });
  });

  it("rejects unknown filters and invalid alert ids", async () => {
    const filterResponse = await scoped("get", "/api/alerts?type=bad&unknown=true");
    const idResponse = await scoped("patch", "/api/alerts/not-an-id/acknowledge");

    expect(filterResponse.status).toBe(400);
    expect(idResponse.status).toBe(400);
    expect(alertMocks.listAlerts).not.toHaveBeenCalled();
    expect(alertMocks.acknowledgeAlert).not.toHaveBeenCalled();
  });

  it("runs checks through the service without accepting client alert records", async () => {
    alertMocks.generateStoreAlerts.mockResolvedValue({
      created: 2,
      refreshed: 1,
      resolved: 0,
      activeConditions: 3,
    });
    const response = await scoped("post", "/api/alerts/run-check").send({ expiryWarningDays: 14 });
    const invalid = await scoped("post", "/api/alerts/run-check").send({
      expiryWarningDays: 14,
      type: "LOW_STOCK",
      title: "client controlled",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.created).toBe(2);
    expect(alertMocks.generateStoreAlerts.mock.calls[0][0].toHexString()).toBe(storeId);
    expect(alertMocks.generateStoreAlerts.mock.calls[0][1]).toEqual({ expiryWarningDays: 14 });
    expect(invalid.status).toBe(400);
  });

  it("acknowledges and resolves by explicit state transitions", async () => {
    alertMocks.acknowledgeAlert.mockResolvedValue({ _id: alertId, status: "ACKNOWLEDGED" });
    alertMocks.resolveAlert.mockResolvedValue({ _id: alertId, status: "RESOLVED" });

    const acknowledged = await scoped("patch", `/api/alerts/${alertId}/acknowledge`);
    const resolved = await scoped("patch", `/api/alerts/${alertId}/resolve`);

    expect(acknowledged.status).toBe(200);
    expect(acknowledged.body.data.status).toBe("ACKNOWLEDGED");
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.status).toBe("RESOLVED");
  });

  it("reports invalid state transitions and rejects store headers outside development", async () => {
    alertMocks.acknowledgeAlert.mockRejectedValue(
      new ApiError(409, "INVALID_ALERT_TRANSITION", "A resolved alert cannot be acknowledged."),
    );
    const transition = await scoped("patch", `/api/alerts/${alertId}/acknowledge`);
    const production = await request(createApp({
      nodeEnv: "production",
      sessionSecret: "unit-test-session-secret-with-at-least-32-chars",
      sessionStore: new session.MemoryStore(),
    }))
      .get("/api/alerts")
      .set("X-Store-Id", storeId);

    expect(transition.status).toBe(409);
    expect(production.status).toBe(401);
    expect(production.body.error.code).toBe("AUTHENTICATION_REQUIRED");
  });
});
