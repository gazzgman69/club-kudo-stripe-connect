import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { Sentry } from "../lib/sentry";
import { invalidCsrfTokenError } from "./csrf";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: { code: "not_found", message: `Route ${req.method} ${req.path} not found` },
    requestId: req.id,
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  let status = 500;
  let code = "internal_error";
  let message = "Internal server error";
  let details: unknown;

  if (err instanceof HttpError) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    status = 400;
    code = "validation_error";
    message = "Request validation failed";
    details = err.issues;
  } else if (err === invalidCsrfTokenError || (err as Error)?.message?.includes("csrf")) {
    status = 403;
    code = "csrf_invalid";
    message = "Invalid or missing CSRF token";
  } else if ((err as Error)?.message?.startsWith("CORS:")) {
    status = 403;
    code = "cors_forbidden";
    message = (err as Error).message;
  }

  let sentryEventId: string | undefined;
  if (status >= 500) {
    req.log.error({ err, requestId: req.id }, "request failed");
    sentryEventId = Sentry.captureException(err, {
      tags: { requestId: String(req.id) },
    });
  } else if (status >= 400) {
    req.log.warn({ err, status, code, requestId: req.id }, "request rejected");
  }

  res.status(status).json({
    error: { code, message, ...(details !== undefined ? { details } : {}) },
    requestId: req.id,
    ...(sentryEventId ? { sentryEventId } : {}),
  });
}
