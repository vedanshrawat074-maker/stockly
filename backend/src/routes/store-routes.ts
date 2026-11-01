import { Router } from "express";
import {
  createStoreHandler,
  getCurrentStoreHandler,
  listStoresHandler,
  selectStoreHandler,
} from "../controllers/store-controller";
import { requireAuthentication } from "../middleware/authentication";

const storeRoutes = Router();
storeRoutes.use(requireAuthentication());
storeRoutes.get("/", listStoresHandler);
storeRoutes.post("/", createStoreHandler);
storeRoutes.get("/current", getCurrentStoreHandler);
storeRoutes.post("/current", selectStoreHandler);

export default storeRoutes;
