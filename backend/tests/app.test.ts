import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

describe("API foundation", () => {
  const app = createApp();

  it("reports API health independently from the database", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      database: "disconnected",
    });
  });

  it("returns a standard JSON error for unknown routes", async () => {
    const response = await request(app).get("/api/unknown");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "The requested resource was not found.",
      },
    });
    expect(response.headers["content-type"]).toMatch(/application\/json/);
  });

  it("returns a standard validation error for malformed JSON requests", async () => {
    const response = await request(app)
      .post("/api/health")
      .set("Content-Type", "application/json")
      .send('{"invalid":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "INVALID_JSON",
        message: "Request body contains invalid JSON.",
      },
    });
  });
});
