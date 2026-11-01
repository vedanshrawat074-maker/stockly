import { Types } from "mongoose";

export function serialize(value: unknown): unknown {
  if (value instanceof Types.Decimal128) {
    return value.toString();
  }

  if (value instanceof Types.ObjectId) {
    return value.toHexString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(serialize);
  }

  if (value && typeof value === "object") {
    const plainValue =
      "toObject" in value && typeof value.toObject === "function"
        ? value.toObject()
        : value;

    return Object.fromEntries(
      Object.entries(plainValue).map(([key, child]) => [key, serialize(child)]),
    );
  }

  return value;
}
