import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  MONGODB_URI: z
    .string()
    .trim()
    .min(1, "MONGODB_URI is required")
    .refine(
      (uri) => uri.startsWith("mongodb://") || uri.startsWith("mongodb+srv://"),
      "MONGODB_URI must be a MongoDB connection string",
    ),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must contain at least 32 characters"),
  SESSION_COOKIE_SECURE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  SESSION_COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
  ML_SERVICE_URL: z.string().url().default("http://127.0.0.1:8000"),
  ML_SERVICE_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(5_000),
  RESTOCKING_PLANNING_HORIZON_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  RESTOCKING_SAFETY_BUFFER_DAYS: z.coerce.number().int().min(0).max(29).default(2),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
}).superRefine((config, context) => {
  if (config.RESTOCKING_PLANNING_HORIZON_DAYS + config.RESTOCKING_SAFETY_BUFFER_DAYS > 30) {
    context.addIssue({
      code: "custom",
      path: ["RESTOCKING_SAFETY_BUFFER_DAYS"],
      message: "Planning horizon plus safety buffer must not exceed the 30-day forecast limit.",
    });
  }
  if (config.NODE_ENV === "production" && !config.SESSION_COOKIE_SECURE) {
    context.addIssue({
      code: "custom",
      path: ["SESSION_COOKIE_SECURE"],
      message: "Production session cookies must set SESSION_COOKIE_SECURE=true.",
    });
  }
  if (config.NODE_ENV === "production") {
    const origins = config.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
    if (origins.length === 0 || origins.some((origin) => {
      try {
        return new URL(origin).protocol !== "https:";
      } catch {
        return true;
      }
    })) {
      context.addIssue({
        code: "custom",
        path: ["CORS_ORIGIN"],
        message: "Production CORS_ORIGIN must contain only explicit HTTPS frontend origins.",
      });
    }
  }
  if (config.SESSION_COOKIE_SAME_SITE === "none" && !config.SESSION_COOKIE_SECURE) {
    context.addIssue({
      code: "custom",
      path: ["SESSION_COOKIE_SECURE"],
      message: "SameSite=None requires SESSION_COOKIE_SECURE=true.",
    });
  }
});

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  mongodbUri: string;
  sessionSecret: string;
  sessionCookieSecure: boolean;
  sessionCookieSameSite: "lax" | "strict" | "none";
  mlServiceUrl: string;
  mlServiceTimeoutMs: number;
  restockingPlanningHorizonDays: number;
  restockingSafetyBufferDays: number;
  corsOrigins: string[];
};

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return {
    nodeEnv: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    mongodbUri: parsed.data.MONGODB_URI,
    sessionSecret: parsed.data.SESSION_SECRET,
    sessionCookieSecure: parsed.data.SESSION_COOKIE_SECURE,
    sessionCookieSameSite: parsed.data.SESSION_COOKIE_SAME_SITE,
    mlServiceUrl: parsed.data.ML_SERVICE_URL,
    mlServiceTimeoutMs: parsed.data.ML_SERVICE_TIMEOUT_MS,
    restockingPlanningHorizonDays: parsed.data.RESTOCKING_PLANNING_HORIZON_DAYS,
    restockingSafetyBufferDays: parsed.data.RESTOCKING_SAFETY_BUFFER_DAYS,
    corsOrigins: parsed.data.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean),
  };
}