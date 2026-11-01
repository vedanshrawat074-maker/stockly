import type { AppConfig } from "./env";

export const DEVELOPMENT_STORE_NAME = "Stockly Local Development Store";

export type DevelopmentStoreSeed = {
  name: string;
  address: string;
  timezone: string;
  currency: string;
};

export const DEVELOPMENT_STORE_SEED: DevelopmentStoreSeed = {
  name: DEVELOPMENT_STORE_NAME,
  address: "Local development environment",
  timezone: "Asia/Kolkata",
  currency: "INR",
};

export class ProvisioningTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvisioningTargetError";
  }
}

export async function findOrCreateDevelopmentStore<T extends { _id: { toString(): string } }>(
  findByName: (name: string) => Promise<T | null>,
  create: (seed: DevelopmentStoreSeed) => Promise<T>,
): Promise<{ store: T; created: boolean }> {
  const existingStore = await findByName(DEVELOPMENT_STORE_NAME);
  if (existingStore) return { store: existingStore, created: false };
  return { store: await create(DEVELOPMENT_STORE_SEED), created: true };
}

export function assertDevelopmentStoreTarget(
  config: Pick<AppConfig, "nodeEnv" | "mongodbUri">,
): void {
  if (config.nodeEnv !== "development") {
    throw new ProvisioningTargetError("Store provisioning is allowed only when NODE_ENV=development.");
  }

  let uri: URL;
  try {
    uri = new URL(config.mongodbUri);
  } catch {
    throw new ProvisioningTargetError("MONGODB_URI must identify the local stockly development database.");
  }

  const hostname = uri.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    throw new ProvisioningTargetError("Store provisioning is restricted to a local MongoDB instance.");
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(uri.pathname.slice(1));
  } catch {
    throw new ProvisioningTargetError("MONGODB_URI must identify the local stockly development database.");
  }

  if (/test/i.test(databaseName)) {
    throw new ProvisioningTargetError("Refusing to provision a test database.");
  }
  if (databaseName !== "stockly") {
    throw new ProvisioningTargetError('Store provisioning requires the database name "stockly".');
  }
}
