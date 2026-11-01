import { Router } from "express";
import {
  createProductHandler,
  deleteProductHandler,
  getProductHandler,
  listProductsHandler,
  updateProductHandler,
} from "../controllers/product-controller";

const productRoutes = Router();

productRoutes.post("/", createProductHandler);
productRoutes.get("/", listProductsHandler);
productRoutes.get("/:productId", getProductHandler);
productRoutes.patch("/:productId", updateProductHandler);
productRoutes.delete("/:productId", deleteProductHandler);

export default productRoutes;
