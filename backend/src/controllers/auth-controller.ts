import type { RequestHandler } from "express";
import { ApiError } from "../utils/api-error";
import { loginSchema, registerSchema } from "../validators/auth-validator";
import { registerUser, toPublicUser, verifyLogin } from "../services/auth-service";
import {
  destroySession,
  newCsrfToken,
  regenerateSession,
  saveSession,
  getActiveSessionUser,
} from "../middleware/authentication";

export const registerHandler: RequestHandler = async (request, response) => {
  const input = registerSchema.parse(request.body);
  const user = await registerUser(input);
  await regenerateSession(request);
  request.session.userId = user.id;
  request.session.csrfToken = newCsrfToken();
  await saveSession(request);
  response.status(201).json({ data: { user, csrfToken: request.session.csrfToken } });
};

export const loginHandler: RequestHandler = async (request, response) => {
  const input = loginSchema.parse(request.body);
  const user = await verifyLogin(input.email, input.password);
  await regenerateSession(request);
  request.session.userId = user.id;
  request.session.csrfToken = newCsrfToken();
  await saveSession(request);
  response.status(200).json({ data: { user, csrfToken: request.session.csrfToken } });
};

export const logoutHandler: RequestHandler = async (request, response) => {
  await destroySession(request);
  response.clearCookie("stockly.sid", { path: "/" });
  response.status(204).end();
};

export const meHandler: RequestHandler = async (request, response) => {
  const user = await getActiveSessionUser(request);
  if (!user) throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Please sign in to continue.");
  if (!request.session.csrfToken) {
    request.session.csrfToken = newCsrfToken();
    await saveSession(request);
  }
  response.status(200).json({
    data: {
      user: toPublicUser(user),
      csrfToken: request.session.csrfToken,
    },
  });
};
