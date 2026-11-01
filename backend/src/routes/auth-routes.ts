import { rateLimit } from "express-rate-limit";
import { Router } from "express";
import { loginHandler, logoutHandler, meHandler, registerHandler } from "../controllers/auth-controller";
import { requireAuthentication, requireTrustedOrigin } from "../middleware/authentication";

function authRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_request, response) => {
      response.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many authentication attempts. Please try again later.",
        },
      });
    },
  });
}

export function createAuthRoutes(allowedOrigins: string[]) {
  const routes = Router();
  routes.post("/register", requireTrustedOrigin(allowedOrigins), authRateLimiter(), registerHandler);
  routes.post("/login", requireTrustedOrigin(allowedOrigins), authRateLimiter(), loginHandler);
  routes.post("/logout", requireAuthentication(), logoutHandler);
  routes.get("/me", meHandler);
  return routes;
}
