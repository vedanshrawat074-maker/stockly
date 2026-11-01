import mongoose, { type ClientSession } from "mongoose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BatchModel } from "../src/models/batch";
import { InventoryModel } from "../src/models/inventory";
import { ProductModel } from "../src/models/product";
import { StockMovementModel } from "../src/models/stock-movement";
import { receiveBatch } from "../src/services/inventory-service";
import { runInTransaction } from "../src/services/transaction-service";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MongoDB transaction handling", () => {
  it("runs work in a session and always closes the session", async () => {
    const session = {
      withTransaction: vi.fn(async (operation: (value: ClientSession) => Promise<string>) =>
        operation(session as unknown as ClientSession),
      ),
      endSession: vi.fn(async () => undefined),
    };
    vi.spyOn(mongoose, "startSession").mockResolvedValue(session as unknown as ClientSession);

    await expect(runInTransaction(async () => "committed")).resolves.toBe("committed");
    expect(session.withTransaction).toHaveBeenCalledOnce();
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it("returns a clear service-unavailable error when transactions are unsupported", async () => {
    const session = {
      withTransaction: vi.fn().mockRejectedValue(
        Object.assign(
          new Error("Transaction numbers are only allowed on a replica set member or mongos"),
          { code: 20 },
        ),
      ),
      endSession: vi.fn(async () => undefined),
    };
    vi.spyOn(mongoose, "startSession").mockResolvedValue(session as unknown as ClientSession);

    await expect(runInTransaction(async () => "never committed")).rejects.toMatchObject({
      statusCode: 503,
      code: "TRANSACTIONS_UNSUPPORTED",
    });
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it("creates inventory, batch, and receipt movement in one transaction session", async () => {
    const session = {
      withTransaction: vi.fn(async (operation: (value: ClientSession) => Promise<unknown>) =>
        operation(session as unknown as ClientSession),
      ),
      endSession: vi.fn(async () => undefined),
    };
    vi.spyOn(mongoose, "startSession").mockResolvedValue(session as unknown as ClientSession);

    const productId = new mongoose.Types.ObjectId();
    const storeId = new mongoose.Types.ObjectId();
    const batchId = new mongoose.Types.ObjectId();
    const productQuery = {
      session: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({ _id: productId }),
    };
    const inventory = { _id: new mongoose.Types.ObjectId() };
    const batch = { _id: batchId };
    const movement = { _id: new mongoose.Types.ObjectId() };
    vi.spyOn(ProductModel, "findOne").mockReturnValue(productQuery as never);
    const inventoryUpsert = vi
      .spyOn(InventoryModel, "findOneAndUpdate")
      .mockResolvedValue(inventory as never);
    const createBatch = vi.spyOn(BatchModel, "create").mockResolvedValue([batch] as never);
    const createMovement = vi
      .spyOn(StockMovementModel, "create")
      .mockResolvedValue([movement] as never);

    const result = await receiveBatch(storeId, productId, {
      batchNumber: "LOT-1",
      quantity: "1.25",
      unitCost: "0.125",
    });

    expect(result).toEqual({ inventory, batch, movement });
    expect(inventoryUpsert).toHaveBeenCalledWith(
      { store: storeId, product: productId },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({ store: storeId, product: productId }),
      }),
      expect.objectContaining({ session }),
    );
    expect(createBatch.mock.calls[0][1]).toEqual({ session });
    expect(createMovement.mock.calls[0][1]).toEqual({ session });
    expect(createMovement.mock.calls[0][0][0]).toMatchObject({
      batch: batchId,
      movementType: "receipt",
      reason: "Batch received: LOT-1",
    });
  });

  it("does not attempt writes when the transaction cannot start", async () => {
    const session = {
      withTransaction: vi.fn().mockRejectedValue(
        Object.assign(new Error("Transactions are not supported"), { code: 20 }),
      ),
      endSession: vi.fn(async () => undefined),
    };
    vi.spyOn(mongoose, "startSession").mockResolvedValue(session as unknown as ClientSession);
    const createBatch = vi.spyOn(BatchModel, "create");
    const createMovement = vi.spyOn(StockMovementModel, "create");

    await expect(
      receiveBatch(new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(), {
        batchNumber: "LOT-2",
        quantity: "1",
        unitCost: "1",
      }),
    ).rejects.toMatchObject({ code: "TRANSACTIONS_UNSUPPORTED" });
    expect(createBatch).not.toHaveBeenCalled();
    expect(createMovement).not.toHaveBeenCalled();
  });
});
