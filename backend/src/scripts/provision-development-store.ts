import "dotenv/config";
import mongoose from "mongoose";
import { connectToDatabase } from "../config/database";
import {
  assertDevelopmentStoreTarget,
  findOrCreateDevelopmentStore,
  ProvisioningTargetError,
} from "../config/development-store-provisioning";
import { loadConfig } from "../config/env";
import { StoreModel } from "../models/store";

async function provisionDevelopmentStore(): Promise<void> {
  const config = loadConfig();
  assertDevelopmentStoreTarget(config);

  try {
    await connectToDatabase(config.mongodbUri);

    const result = await findOrCreateDevelopmentStore(
      async (name) => StoreModel.findOne({ name }),
      async (seed) => StoreModel.create(seed),
    );
    const action = result.created ? "Created" : "Using existing";
    console.info(`${action} development store: ${result.store._id.toString()}`);
  } finally {
    await mongoose.disconnect();
  }
}

void provisionDevelopmentStore().catch((error: unknown) => {
  if (error instanceof ProvisioningTargetError) {
    console.error(error.message);
  } else {
    const errorType = error instanceof Error ? error.name : "Unknown error";
    console.error(`Development store provisioning failed (${errorType}). Verify the backend environment and local MongoDB connection.`);
  }
  process.exitCode = 1;
});
