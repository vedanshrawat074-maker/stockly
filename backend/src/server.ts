import "dotenv/config";
import { createApp } from "./app";
import { connectToDatabase } from "./config/database";
import { loadConfig } from "./config/env";

const config = loadConfig();
const app = createApp({
  corsOrigins: config.corsOrigins,
  nodeEnv: config.nodeEnv,
  sessionSecret: config.sessionSecret,
  sessionMongoUrl: config.mongodbUri,
  sessionCookieSecure: config.sessionCookieSecure,
  sessionCookieSameSite: config.sessionCookieSameSite,
  mlServiceUrl: config.mlServiceUrl,
  mlServiceTimeoutMs: config.mlServiceTimeoutMs,
  restockingPlanningHorizonDays: config.restockingPlanningHorizonDays,
  restockingSafetyBufferDays: config.restockingSafetyBufferDays,
});
const server = app.listen(config.port, () => {
  console.info(`Stockly API listening on port ${config.port}`);
});

void connectToDatabase(config.mongodbUri).catch((error: unknown) => {
  console.error("MongoDB connection failed:", error);
});

function shutdown(signal: string): void {
  console.info(`${signal} received; shutting down server`);
  server.close((error) => {
    if (error) {
      console.error("HTTP server shutdown failed:", error);
      process.exitCode = 1;
    }

    void import("mongoose")
      .then(async ({ default: mongoose }) => {
        await app.locals.sessionStore?.close();
        await mongoose.disconnect();
      })
      .catch((disconnectError: unknown) => {
        console.error("MongoDB shutdown failed:", disconnectError);
        process.exitCode = 1;
      });
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));