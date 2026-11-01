import { Router } from "express";
import {
  getInventoryHandler,
  listBatchesHandler,
  listInventoryHandler,
  receiveBatchHandler,
} from "../controllers/inventory-controller";

const inventoryRoutes = Router();

inventoryRoutes.get("/", listInventoryHandler);
inventoryRoutes.post("/:productId/batches", receiveBatchHandler);
inventoryRoutes.get("/:productId/batches", listBatchesHandler);
inventoryRoutes.get("/:productId", getInventoryHandler);

export default inventoryRoutes;
