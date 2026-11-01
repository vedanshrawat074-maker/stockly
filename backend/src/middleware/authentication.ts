import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { Types } from "mongoose";
import { UserModel } from "../models/user";
import { ApiError } from "../utils/api-error";
import { objectIdSchema } from "../validators/common-validator";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function getActiveSessionUser(request: Request) {
  const userId = request.session.userId;
  if (!userId) return null;

  const parsedId = objectIdSchema.safeParse(userId);
  if (!parsedId.success) {
    await destroySession(request);
    throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Please sign in to continue.");
  }

  const user = await UserModel.findById(new Types.ObjectId(parsedId.data));
  if (!user || user.status !== "active") {
    await destroySession(request);
    throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Please sign in to continue.");
  }
  return user;
}

export function destroySession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.destroy((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function saveSession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.save((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function regenerateSession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function newCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function requireAuthentication(): RequestHandler {
  return async (request, response, next) => {
    try {
      const user = await getActiveSessionUser(request);
      if (!user) throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Please sign in to continue.");
      response.locals.authUser = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireTrustedOrigin(allowedOrigins: string[]): RequestHandler {
  return (request, _response, next) => {
    const origin = request.get("Origin");
    if (!origin || !allowedOrigins.includes(origin)) {
      next(new ApiError(403, "UNTRUSTED_ORIGIN", "This request origin is not allowed."));
      return;
    }
    next();
  };
}

export function csrfProtection(allowedOrigins: string[]): RequestHandler {
  return (request, _response, next) => {
    if (!unsafeMethods.has(request.method) || !request.session.userId) {
      next();
      return;
    }

    const origin = request.get("Origin");
    const expectedToken = request.session.csrfToken;
    const actualToken = request.get("X-CSRF-Token");
    if (!origin || !allowedOrigins.includes(origin) || !expectedToken || !actualToken) {
      next(new ApiError(403, "CSRF_VALIDATION_FAILED", "The request could not be verified."));
      return;
    }

    const expected = Buffer.from(expectedToken);
    const actual = Buffer.from(actualToken);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      next(new ApiError(403, "CSRF_VALIDATION_FAILED", "The request could not be verified."));
      return;
    }
    next();
  };
}
