import { Router, type IRouter, type Request, type Response } from "express";
import { generateCsrfToken } from "../middlewares/csrf";

const router: IRouter = Router();

// Issues a CSRF token bound to the current session. Clients must call this
// before any state-changing request and echo the value back via the
// `x-csrf-token` header (or `_csrf` body field).
//
// Touching `req.session` forces express-session to persist the session
// (because `saveUninitialized: false`). Without this, every request would
// generate a fresh ephemeral session ID and CSRF validation would fail
// because the token's session-binding wouldn't match.
router.get("/csrf-token", (req: Request, res: Response) => {
  req.session.csrfBound = true;
  const token = generateCsrfToken(req, res);
  res.json({ csrfToken: token });
});

export default router;
