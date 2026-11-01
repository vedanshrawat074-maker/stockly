import { Router } from "express";
import { createForecastHandler } from "../controllers/forecast-controller";

const forecastRoutes = Router();

forecastRoutes.post("/", createForecastHandler);

export default forecastRoutes;
