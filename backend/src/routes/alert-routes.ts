import { Router } from "express";
import {
  acknowledgeAlertHandler,
  listAlertsHandler,
  resolveAlertHandler,
  runAlertCheckHandler,
} from "../controllers/alert-controller";

const alertRoutes = Router();

alertRoutes.get("/", listAlertsHandler);
alertRoutes.post("/run-check", runAlertCheckHandler);
alertRoutes.patch("/:alertId/acknowledge", acknowledgeAlertHandler);
alertRoutes.patch("/:alertId/resolve", resolveAlertHandler);

export default alertRoutes;
