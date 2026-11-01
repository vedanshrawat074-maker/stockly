import cors from "cors";
import MongoStore from "connect-mongo";
import express from "express";
import session, { type Store } from "express-session";
import helmet from "helmet";
import { randomBytes } from "node:crypto";
import { createAuthRoutes } from "./routes/auth-routes";
import { errorHandler } from "./middleware/error-handler";
import { notFound } from "./middleware/not-found";
import { storeContext } from "./middleware/store-context";
import healthRoutes from "./routes/health-routes";
import inventoryRoutes from "./routes/inventory-routes";
import productRoutes from "./routes/product-routes";
import saleRoutes from "./routes/sale-routes";
import alertRoutes from "./routes/alert-routes";
import demandRoutes from "./routes/demand-routes";
import forecastRoutes from "./routes/forecast-routes";
import restockingRoutes from "./routes/restocking-routes";
import storeRoutes from "./routes/store-routes";
import { csrfProtection } from "./middleware/authentication";

export type AppOptions = {
  corsOrigins?: string[];
  nodeEnv?: string;
  sessionSecret?: string;
  sessionMongoUrl?: string;
  sessionStore?: Store;
  sessionCookieSecure?: boolean;
  sessionCookieSameSite?: "lax" | "strict" | "none";
  mlServiceUrl?: string;
  mlServiceTimeoutMs?: number;
  restockingPlanningHorizonDays?: number;
  restockingSafetyBufferDays?: number;
};

export function createApp(options: AppOptions = {}) {
  const allowedOrigins = options.corsOrigins ?? ["http://localhost:3000"];
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const sessionSecret = options.sessionSecret ?? process.env.SESSION_SECRET;
  const sessionMongoUrl = options.sessionMongoUrl;
  if (nodeEnv === "production" && (!sessionSecret || (!sessionMongoUrl && !options.sessionStore))) {
    throw new Error("Production requires a session secret and a configured session store.");
  }
  const secureCookie = options.sessionCookieSecure ?? process.env.SESSION_COOKIE_SECURE === "true";
  const rawSameSite = options.sessionCookieSameSite ?? process.env.SESSION_COOKIE_SAME_SITE ?? "lax";
  if (!["lax", "strict", "none"].includes(rawSameSite)) {
    throw new Error("SESSION_COOKIE_SAME_SITE must be lax, strict, or none.");
  }
  const sameSite = rawSameSite as "lax" | "strict" | "none";
  if (sameSite === "none" && !secureCookie) {
    throw new Error("SameSite=None requires secure session cookies.");
  }
  const app = express();
  app.locals.mlServiceUrl =
    options.mlServiceUrl ?? process.env.ML_SERVICE_URL ?? "http://127.0.0.1:8000";
  app.locals.mlServiceTimeoutMs = options.mlServiceTimeoutMs ?? Number(process.env.ML_SERVICE_TIMEOUT_MS ?? 5_000);
  app.locals.restockingPlanningHorizonDays =
    options.restockingPlanningHorizonDays ?? Number(process.env.RESTOCKING_PLANNING_HORIZON_DAYS ?? 7);
  app.locals.restockingSafetyBufferDays =
    options.restockingSafetyBufferDays ?? Number(process.env.RESTOCKING_SAFETY_BUFFER_DAYS ?? 2);

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        callback(null, origin === undefined || allowedOrigins.includes(origin));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));

  app.use("/api/health", healthRoutes);
  const sessionStore = options.sessionStore ?? (sessionMongoUrl
    ? MongoStore.create({
        mongoUrl: sessionMongoUrl,
        collectionName: "sessions",
        ttl: 60 * 60 * 24,
        autoRemove: "native",
      })
    : undefined);
  const sessionMiddleware = session({
    name: "stockly.sid",
    secret: sessionSecret ?? randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      secure: secureCookie,
      sameSite,
      maxAge: 24 * 60 * 60 * 1000,
      path: "/",
    },
  });
  app.locals.sessionStore = sessionStore;
  if (nodeEnv === "production") app.set("trust proxy", 1);
  const csrfMiddleware = csrfProtection(allowedOrigins);
  const storeScoped = [sessionMiddleware, csrfMiddleware, storeContext(nodeEnv)];

  app.use("/api/auth", sessionMiddleware, csrfMiddleware, createAuthRoutes(allowedOrigins));
  app.use("/api/stores", sessionMiddleware, csrfMiddleware, storeRoutes);
  app.use("/api/products", ...storeScoped, productRoutes);
  app.use("/api/inventory", ...storeScoped, inventoryRoutes);
  app.use("/api/sales", ...storeScoped, saleRoutes);
  app.use("/api/alerts", ...storeScoped, alertRoutes);
  app.use("/api/demand", ...storeScoped, demandRoutes);
  app.use("/api/forecasts", ...storeScoped, forecastRoutes);
  app.use("/api/restocking", ...storeScoped, restockingRoutes);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}