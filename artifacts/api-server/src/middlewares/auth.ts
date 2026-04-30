import type { Request, Response, NextFunction, RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, userRolesTable } from "@workspace/db";
import { HttpError } from "./errorHandler";

/**
 * Reject the request with 401 if the caller has no session-bound user.
 * Use as the first gate on any route that should only be reachable by
 * a signed-in user.
 */
export const requireAuth: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  if (!req.session?.userId) {
    return next(
      new HttpError(
        401,
        "unauthorized",
        "Authentication required",
      ),
    );
  }
  next();
};

/**
 * Reject the request with 403 if the caller's roles don't include any
 * of the supplied required roles. Implies requireAuth — composes
 * cleanly when used after it: `app.use(path, requireAuth, requireRole("admin"))`.
 *
 * Roles are looked up per-request from the user_roles join table.
 * It's a single indexed query against a small table; if it ever
 * shows up in a profile we can cache role sets in the session at
 * sign-in time, but premature for now.
 */
export function requireRole(
  ...required: ReadonlyArray<"admin" | "supplier">
): RequestHandler {
  if (required.length === 0) {
    throw new Error("requireRole called with no roles");
  }
  return async (req, _res, next) => {
    const userId = req.session?.userId;
    if (!userId) {
      return next(
        new HttpError(
          401,
          "unauthorized",
          "Authentication required",
        ),
      );
    }

    try {
      const rows = await db
        .select({ role: userRolesTable.role })
        .from(userRolesTable)
        .where(eq(userRolesTable.userId, userId));
      const roles = new Set(rows.map((r) => r.role));
      const ok = required.some((r) => roles.has(r));
      if (!ok) {
        return next(
          new HttpError(
            403,
            "forbidden",
            `Requires one of role(s): ${required.join(", ")}`,
          ),
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
