import { Router } from "express";
import {
  adjustClothingVariantStockHandler,
  createClothingProductHandler,
  createClothingVariantHandler,
  listClothingVariantsHandler,
  updateClothingVariantHandler,
} from "../controllers/clothing-controller";

const clothingRoutes = Router();

clothingRoutes.post("/products", createClothingProductHandler);
clothingRoutes.post("/products/:productId/variants", createClothingVariantHandler);
clothingRoutes.get("/products/:productId/variants", listClothingVariantsHandler);
clothingRoutes.patch("/variants/:variantId", updateClothingVariantHandler);
clothingRoutes.post("/variants/:variantId/adjustments", adjustClothingVariantStockHandler);

export default clothingRoutes;
