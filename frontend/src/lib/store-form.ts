import type { CreateStoreInput } from "./types";

export function normalizeCreateStoreInput(input: CreateStoreInput): CreateStoreInput {
  return {
    name: input.name.trim(),
    address: input.address.trim(),
    timezone: input.timezone.trim(),
    currency: input.currency.trim().toUpperCase(),
    shopType: input.shopType,
  };
}
