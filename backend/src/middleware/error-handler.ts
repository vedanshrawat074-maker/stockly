import type { ErrorRequestHandler } from "express";
import mongoose from "mongoose";
import { ZodError } from "zod";
import { ApiError } from "../utils/api-error";

type HttpError = Error & {
  code?: number;
  status?: number;
  type?: string;
};

function isHttpError(error: unknown): error is HttpError {
  return error instanceof Error;
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (error instanceof ApiError) {
    response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (isHttpError(error) && error.type === "entity.parse.failed") {
    response.status(400).json({
      error: {
        code: "INVALID_JSON",
        message: "Request body contains invalid JSON.",
      },
    });
    return;
  }

  if (isHttpError(error) && error.status === 413) {
    response.status(413).json({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Request body is too large.",
      },
    });
    return;
  }

  if (isHttpError(error) && error.code === 11000) {
    response.status(409).json({
      error: {
        code: "DUPLICATE_RESOURCE",
        message: "A resource with one of these unique values already exists in this store.",
      },
    });
    return;
  }

  if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError) {
    response.status(400).json({
      error: {
        code: "MODEL_VALIDATION_ERROR",
        message: "The request contains invalid model values.",
        details:
          error instanceof mongoose.Error.ValidationError
            ? Object.values(error.errors).map((item) => ({
                path: item.path,
                message: item.message,
              }))
            : [{ path: error.path, message: error.message }],
      },
    });
    return;
  }

  console.error("Unhandled request error:", error);
  response.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
    },
  });
};
