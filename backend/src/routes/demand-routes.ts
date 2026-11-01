import { Router } from "express";
import { getDemandHistoryHandler } from "../controllers/demand-controller";

const demandRoutes = Router();

demandRoutes.get("/history", getDemandHistoryHandler);

export default demandRoutes;
