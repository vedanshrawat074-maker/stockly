import { Router } from "express";
import {
  adjustClothingVariantStockHandler,
  createClothingProductHandler,
  createClothingVariantHandler,
  listClothingVariantsHandler,
  updateClothingVariantHandler,
} from "../controllers/clothing-controller";
import {
  createClothingExchangeHandler,
  createClothingReturnHandler,
  createClothingSaleHandler,
  getClothingExchangeHandler,
  getClothingReturnHandler,
  getClothingSaleHandler,
  listClothingExchangesHandler,
  listClothingReturnsHandler,
  listClothingSalesHandler,
} from "../controllers/clothing-sales-controller";
import { clothingAnalyticsHandler } from "../controllers/clothing-analytics-controller";

const clothingRoutes = Router();

clothingRoutes.post("/products", createClothingProductHandler);
clothingRoutes.post("/products/:productId/variants", createClothingVariantHandler);
clothingRoutes.get("/products/:productId/variants", listClothingVariantsHandler);
clothingRoutes.patch("/variants/:variantId", updateClothingVariantHandler);
clothingRoutes.post("/variants/:variantId/adjustments", adjustClothingVariantStockHandler);
clothingRoutes.post("/sales", createClothingSaleHandler);
clothingRoutes.get("/sales", listClothingSalesHandler);
clothingRoutes.get("/sales/:saleId", getClothingSaleHandler);
clothingRoutes.post("/returns", createClothingReturnHandler);
clothingRoutes.get("/returns", listClothingReturnsHandler);
clothingRoutes.get("/returns/:returnId", getClothingReturnHandler);
clothingRoutes.post("/exchanges", createClothingExchangeHandler);
clothingRoutes.get("/exchanges", listClothingExchangesHandler);
clothingRoutes.get("/exchanges/:exchangeId", getClothingExchangeHandler);
clothingRoutes.get("/analytics", clothingAnalyticsHandler);

export default clothingRoutes;
