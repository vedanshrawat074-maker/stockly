import "dotenv/config";
import mongoose from "mongoose";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { connectToDatabase } from "../config/database";
import {
  assertDevelopmentStoreTarget,
  DEVELOPMENT_STORE_NAME,
  ProvisioningTargetError,
} from "../config/development-store-provisioning";
import { loadConfig } from "../config/env";
import { StoreMembershipModel } from "../models/store-membership";
import { StoreModel } from "../models/store";
import { UserModel } from "../models/user";

async function adoptDevelopmentStoreOwner(): Promise<void> {
  const config = loadConfig();
  assertDevelopmentStoreTarget(config);
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !stdin.isTTY) {
    throw new ProvisioningTargetError(
      "Provide the registered account email and run this command in an interactive terminal.",
    );
  }

  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    const confirmation = await terminal.question(
      `Assign ${DEVELOPMENT_STORE_NAME} to ${email} as OWNER? Type the email to confirm: `,
    );
    if (confirmation.trim().toLowerCase() !== email) {
      throw new ProvisioningTargetError("Email confirmation did not match; no membership was created.");
    }
  } finally {
    terminal.close();
  }

  try {
    await connectToDatabase(config.mongodbUri);
    const store = await StoreModel.findOne({ name: DEVELOPMENT_STORE_NAME });
    const user = await UserModel.findOne({ email, status: "active" });
    if (!store) throw new ProvisioningTargetError("The named development store does not exist.");
    if (!user) throw new ProvisioningTargetError("No active account exists for the confirmed email address.");

    const existingMembership = await StoreMembershipModel.findOne({ store: store._id });
    if (existingMembership) {
      throw new ProvisioningTargetError(
        "The development store already has a membership; refusing to change or add ownership.",
      );
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await StoreMembershipModel.create(
          [{ user: user._id, store: store._id, role: "OWNER", status: "ACTIVE" }],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    console.info(`Assigned development store ${store._id.toString()} to ${user.email} as OWNER.`);
  } finally {
    await mongoose.disconnect();
  }
}

void adoptDevelopmentStoreOwner().catch((error: unknown) => {
  if (error instanceof ProvisioningTargetError) {
    console.error(error.message);
  } else {
    const errorType = error instanceof Error ? error.name : "Unknown error";
    console.error(`Store adoption failed (${errorType}). Verify the backend environment and local MongoDB connection.`);
  }
  process.exitCode = 1;
});
