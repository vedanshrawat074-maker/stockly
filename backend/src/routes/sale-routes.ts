import { Router } from "express";
import { createSaleHandler, listSalesHandler } from "../controllers/sale-controller";

const saleRoutes = Router();

saleRoutes.post("/", createSaleHandler);
saleRoutes.get("/", listSalesHandler);

export default saleRoutes;
