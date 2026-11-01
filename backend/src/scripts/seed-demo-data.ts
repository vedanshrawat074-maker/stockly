import "dotenv/config";
import { emitKeypressEvents } from "node:readline";
import { stdin, stdout } from "node:process";
import { Types } from "mongoose";
import { connectToDatabase } from "../config/database";
import { ProvisioningTargetError } from "../config/development-store-provisioning";
import { loadConfig } from "../config/env";
import { verifyLogin } from "../services/auth-service";
import { objectIdSchema } from "../validators/common-validator";
import { assertActiveStoreOwner, assertDemoSeedTarget, seedDemoDataForStore } from "./demo-seed-data";

type CliOptions = { storeId: Types.ObjectId; ownerEmail: string };

function parseArguments(args: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!["--store-id", "--owner-email"].includes(flag) || !value || value.startsWith("--") || values.has(flag)) {
      throw new ProvisioningTargetError(
        "Usage: npm run seed:demo -- --store-id <STORE_OBJECT_ID> --owner-email <OWNER_EMAIL>",
      );
    }
    values.set(flag, value);
  }

  const parsedStoreId = objectIdSchema.safeParse(values.get("--store-id"));
  if (!parsedStoreId.success) {
    throw new ProvisioningTargetError("Provide an explicit target store ID as a 24-character MongoDB ObjectId.");
  }
  const storeId = new Types.ObjectId(parsedStoreId.data);
  const ownerEmail = values.get("--owner-email")?.trim().toLowerCase();
  if (!ownerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    throw new ProvisioningTargetError("Provide the registered OWNER account email with --owner-email.");
  }
  return { storeId, ownerEmail };
}

function readHiddenPassword(): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return Promise.reject(new ProvisioningTargetError("Run the seeder in an interactive terminal to enter the password securely."));
  }

  return new Promise((resolve, reject) => {
    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdout.write("Account password (input hidden): ");
    let password = "";

    const cleanup = () => {
      stdin.off("keypress", onKeypress);
      stdin.setRawMode(false);
      stdout.write("\n");
    };
    const onKeypress = (text: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new ProvisioningTargetError("Password entry cancelled; no data was written."));
      } else if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(password);
      } else if (key.name === "backspace") {
        password = password.slice(0, -1);
      } else if (!key.ctrl && text) {
        password += text;
      }
    };

    stdin.on("keypress", onKeypress);
  });
}

async function seedDemoData(): Promise<void> {
  const config = loadConfig();
  const args = parseArguments(process.argv.slice(2));
  assertDemoSeedTarget(config, args.storeId.toHexString());

  try {
    await connectToDatabase(config.mongodbUri);
    const ownerPassword = await readHiddenPassword();
    const authenticatedUser = await verifyLogin(args.ownerEmail, ownerPassword);
    const ownerUserId = new Types.ObjectId(authenticatedUser.id);
    await assertActiveStoreOwner(args.storeId, ownerUserId);

    stdout.write(
      `This will only add tagged demo products, batches, and idempotent completed sales to store ${args.storeId.toHexString()}.\n` +
      "Existing business records will not be deleted, reset, or overwritten.\n" +
      `Type the exact store ID ${args.storeId.toHexString()} to authorize the seed: `,
    );
    const confirmation = await readConfirmation();
    if (confirmation !== args.storeId.toHexString()) {
      throw new ProvisioningTargetError("Store ID confirmation did not match; no demo data was written.");
    }

    await assertActiveStoreOwner(args.storeId, ownerUserId);
    const result = await seedDemoDataForStore(args.storeId, ownerUserId);
    console.info("Demo data seeding completed:", result);
  } finally {
    await import("mongoose").then(({ default: mongoose }) => mongoose.disconnect());
  }
}

function readConfirmation(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) {
      reject(new ProvisioningTargetError("Run the seeder in an interactive terminal; no data was written."));
      return;
    }
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk: string) => {
      const lineEnd = chunk.indexOf("\n");
      if (lineEnd >= 0) {
        stdin.off("data", onData);
        resolve(`${value}${chunk.slice(0, lineEnd)}`.replace(/\r$/, "").trim());
      } else {
        value += chunk;
      }
    };
    stdin.on("data", onData);
  });
}

void seedDemoData().catch((error: unknown) => {
  if (error instanceof ProvisioningTargetError) {
    console.error(error.message);
  } else if (error instanceof Error && "code" in error && error.code === "INVALID_CREDENTIALS") {
    console.error("Authentication failed. Verify the OWNER account credentials; no data was written.");
  } else {
    const errorType = error instanceof Error ? error.name : "Unknown error";
    console.error(`Demo data seeding failed (${errorType}). No existing records are intentionally modified.`);
  }
  process.exitCode = 1;
});
