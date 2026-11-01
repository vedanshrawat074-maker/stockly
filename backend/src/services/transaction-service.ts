import mongoose, { type ClientSession } from "mongoose";
import { ApiError } from "../utils/api-error";

function isTransactionUnsupported(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown; cause?: unknown };
  if (
    candidate.code === 20 ||
    candidate.code === 303 ||
    (typeof candidate.message === "string" &&
      /transaction numbers are only allowed|transactions are not supported|replica set|mongos/i.test(
        candidate.message,
      ))
  ) {
    return true;
  }

  return isTransactionUnsupported(candidate.cause);
}

export async function runInTransaction<T>(
  operation: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await mongoose.startSession();

  try {
    const result = await session.withTransaction(() => operation(session));
    if (result === undefined) {
      throw new Error("Transaction completed without a result.");
    }
    return result;
  } catch (error) {
    if (isTransactionUnsupported(error)) {
      throw new ApiError(
        503,
        "TRANSACTIONS_UNSUPPORTED",
        "This operation requires MongoDB transactions. Configure MongoDB as a replica set or use a transaction-capable cluster.",
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
}
