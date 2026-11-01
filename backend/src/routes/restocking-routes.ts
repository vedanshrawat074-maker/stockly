import { Router } from "express";
import { listRestockingRecommendations } from "../controllers/restocking-controller";

const restockingRoutes = Router();

restockingRoutes.get("/recommendations", listRestockingRecommendations);

export default restockingRoutes;
