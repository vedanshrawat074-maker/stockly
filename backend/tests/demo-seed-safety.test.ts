import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { assertDemoSeedTarget } from "../src/scripts/demo-seed-data";

const storeId = new Types.ObjectId().toHexString();

describe("demo data seeder safety", () => {
  it("accepts only an explicit store ID in the local development database", () => {
    expect(() => assertDemoSeedTarget({
      nodeEnv: "development",
      mongodbUri: "mongodb://127.0.0.1:27017/stockly?replicaSet=rs0",
    }, storeId)).not.toThrow();
  });

  it.each([
    ["production", { nodeEnv: "production", mongodbUri: "mongodb://127.0.0.1:27017/stockly" }],
    ["test mode", { nodeEnv: "test", mongodbUri: "mongodb://127.0.0.1:27017/stockly" }],
    ["test database", { nodeEnv: "development", mongodbUri: "mongodb://127.0.0.1:27017/stockly_test" }],
    ["remote host", { nodeEnv: "development", mongodbUri: "mongodb://db.example.test:27017/stockly" }],
    ["another database", { nodeEnv: "development", mongodbUri: "mongodb://127.0.0.1:27017/stockly_backup" }],
  ])("rejects %s before opening a database connection", (_description, config) => {
    expect(() => assertDemoSeedTarget(config, storeId)).toThrow();
  });

  it.each([undefined, "", "not-an-object-id"])("requires an explicit valid target store ID (%s)", (invalidStoreId) => {
    expect(() => assertDemoSeedTarget({
      nodeEnv: "development",
      mongodbUri: "mongodb://localhost:27017/stockly",
    }, invalidStoreId)).toThrow(/explicit target store ID/);
  });
});
