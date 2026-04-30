import express, { type Request, type Response } from "express";
import { getStripe } from "../../lib/stripe";
import {
  dispatchV1Event,
  dispatchV2ThinEvent,
} from "../../lib/stripe-webhooks";

/**
 * POST /api/webhooks/stripe
 *
 * Stripe webhook endpoint. Raw body parsing is mounted at the route
 * level (see app.ts) because signature verification needs the
 * untouched bytes. Handles both V1 events (via webhooks.constructEvent)
 * and V2 thin events (via parseThinEvent) using the same signing
 * secret — Stripe normalises this even when you have separate
 * endpoints.
 *
 * Always responds 200 to acknowledge receipt unless signature
 * verification fails (400) or the secret is unconfigured (503). All
 * downstream side-effect failures are logged but the request still
 * 200s, otherwise Stripe retries indefinitely and amplifies any
 * persistent bug.
 */
export async function handleStripeWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    res.status(503).json({ error: "STRIPE_WEBHOOK_SECRET not configured" });
    return;
  }
  if (!sig || (Array.isArray(sig) && sig.length === 0)) {
    res.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }
  const sigHeader = Array.isArray(sig) ? sig[0] : sig;

  // Body must be a Buffer here (express.raw mounted on this route).
  // Defensive: if for some reason it isn't, signature verification
  // will fail anyway.
  const rawBody = req.body as Buffer;

  const stripe = getStripe();

  // Try V2 thin event first, then fall back to V1. parseThinEvent
  // throws if the event isn't a V2 thin event (or the signature is
  // wrong); same for constructEvent against V1 expectations.
  interface ParsedThinEvent {
    id: string;
    type: string;
  }
  let v2Thin: ParsedThinEvent | null = null;
  let v1Event: import("stripe").Stripe.Event | null = null;
  let lastErr: unknown;
  try {
    const sdkAny = stripe as unknown as {
      parseThinEvent?: (
        body: string | Buffer,
        sig: string,
        secret: string,
      ) => ParsedThinEvent;
    };
    if (typeof sdkAny.parseThinEvent === "function") {
      v2Thin = sdkAny.parseThinEvent(rawBody, sigHeader, webhookSecret);
    }
  } catch (err) {
    lastErr = err;
  }
  if (!v2Thin) {
    try {
      v1Event = stripe.webhooks.constructEvent(
        rawBody,
        sigHeader,
        webhookSecret,
      );
    } catch (err) {
      lastErr = err;
    }
  }

  if (!v2Thin && !v1Event) {
    req.log.warn(
      { err: lastErr },
      "stripe webhook signature verification failed",
    );
    res.status(400).json({ error: "signature verification failed" });
    return;
  }

  try {
    if (v2Thin) {
      await dispatchV2ThinEvent(v2Thin.id, v2Thin.type, { log: req.log });
    } else if (v1Event) {
      await dispatchV1Event(v1Event, { log: req.log });
    }
  } catch (err) {
    req.log.error(
      { err, eventId: v2Thin?.id ?? v1Event?.id },
      "stripe webhook handler threw — acknowledging anyway to prevent retry storm",
    );
  }

  res.status(200).json({ received: true });
}

// Absolute path inside the router, mounted at "/" in app.ts. This
// matches the working pattern used by adminRouter, authRouter,
// suppliersRouter, etc. and avoids the Express 5 trailing-slash gotcha
// where router.post("/") doesn't match a request whose URL was the
// router's mount prefix exactly.
export const stripeWebhookRouter: express.Router = express.Router();
stripeWebhookRouter.post(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json", limit: "1mb" }),
  handleStripeWebhook,
);

export default stripeWebhookRouter;
