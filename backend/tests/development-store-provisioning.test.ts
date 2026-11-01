import { describe, expect, it, vi } from "vitest";
import {
  assertDevelopmentStoreTarget,
  DEVELOPMENT_STORE_NAME,
  DEVELOPMENT_STORE_SEED,
  findOrCreateDevelopmentStore,
} from "../src/config/development-store-provisioning";

describe("development store provisioning safety", () => {
  it("allows only the local stockly database in development", () => {
    expect(() =>
      assertDevelopmentStoreTarget({
        nodeEnv: "development",
        mongodbUri: "mongodb://localhost:27017/stockly?replicaSet=rs0",
      }),
    ).not.toThrow();
    expect(() =>
      assertDevelopmentStoreTarget({
        nodeEnv: "development",
        mongodbUri: "mongodb://127.0.0.1:27017/stockly?replicaSet=rs0",
      }),
    ).not.toThrow();
  });

  it.each([
    ["the dedicated integration database", "mongodb://localhost:27017/stockly_test?replicaSet=rs0"],
    ["another test database", "mongodb://localhost:27017/stockly-integration?replicaSet=rs0"],
    ["any other database", "mongodb://localhost:27017/stockly_backup?replicaSet=rs0"],
    ["a remote database", "mongodb://db.example.test:27017/stockly"],
  ])("refuses %s", (_description, mongodbUri) => {
    expect(() =>
      assertDevelopmentStoreTarget({ nodeEnv: "development", mongodbUri }),
    ).toThrow();
  });

  it("refuses provisioning when the environment is not development", () => {
    expect(() =>
      assertDevelopmentStoreTarget({
        nodeEnv: "test",
        mongodbUri: "mongodb://localhost:27017/stockly",
      }),
    ).toThrow(/NODE_ENV=development/);
  });

  it("reuses the named store without changing it or creating another", async () => {
    const existing = { _id: { toString: () => "existing-object-id" } };
    const findByName = vi.fn().mockResolvedValue(existing);
    const create = vi.fn();

    const result = await findOrCreateDevelopmentStore(findByName, create);

    expect(findByName).toHaveBeenCalledWith(DEVELOPMENT_STORE_NAME);
    expect(create).not.toHaveBeenCalled();
    expect(result).toEqual({ store: existing, created: false });
  });

  it("creates the store with schema fields only when none exists", async () => {
    const created = { _id: { toString: () => "new-object-id" } };
    const findByName = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue(created);

    const result = await findOrCreateDevelopmentStore(findByName, create);

    expect(create).toHaveBeenCalledWith(DEVELOPMENT_STORE_SEED);
    expect(result).toEqual({ store: created, created: true });
    expect(Object.keys(DEVELOPMENT_STORE_SEED).sort()).toEqual(["address", "currency", "name", "timezone"]);
  });
});
