import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema } from "../src/validators/auth-validator";
import { createStoreSchema, selectStoreSchema } from "../src/validators/store-validator";

describe("authentication and store request validation", () => {
  it("normalizes registration and login email addresses", () => {
    expect(registerSchema.parse({
      name: "  Shop Owner ",
      email: "  OWNER@EXAMPLE.COM ",
      password: "a-secure-password",
    })).toEqual({
      name: "Shop Owner",
      email: "owner@example.com",
      password: "a-secure-password",
    });
    expect(loginSchema.parse({
      email: "OWNER@example.com",
      password: "a-secure-password",
    }).email).toBe("owner@example.com");
  });

  it("rejects short passwords and extra fields", () => {
    expect(registerSchema.safeParse({
      name: "Owner",
      email: "owner@example.com",
      password: "short",
      role: "OWNER",
    }).success).toBe(false);
    expect(loginSchema.safeParse({
      email: "owner@example.com",
      password: "a-secure-password",
      storeId: "64b000000000000000000001",
    }).success).toBe(false);
  });

  it("requires a valid time zone, currency code, and ObjectId when creating/selecting stores", () => {
    expect(createStoreSchema.safeParse({
      name: "Local shop",
      address: "1 Main Street",
      timezone: "Asia/Kolkata",
      currency: "inr",
    }).success).toBe(true);
    expect(createStoreSchema.safeParse({
      name: "Shop",
      address: "Street",
      timezone: "not-a-timezone",
      currency: "US",
    }).success).toBe(false);
    expect(selectStoreSchema.safeParse({ storeId: "invalid" }).success).toBe(false);
  });
});
