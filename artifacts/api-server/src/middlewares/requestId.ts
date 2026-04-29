import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";

declare module "express" {
  interface Request {
    id: string;
  }
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header("x-request-id");
  const id =
    incoming && /^[A-Za-z0-9._-]{1,128}$/.test(incoming)
      ? incoming
      : randomUUID();
  req.id = id;
  res.setHeader("x-request-id", id);
  next();
}
