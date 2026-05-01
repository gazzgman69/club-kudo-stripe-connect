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
 * and V2 thin events (via parseThinEvent).
 *
 * Stripe's V1 webhooks and V2 "event destinations" are separate
 * subscriptions in the dashboard, each with its own signing secret,
 * even when they point at the same URL. We accept both:
 *
 *   STRIPE_WEBHOOK_SECRET       - V1 webhook signing secret (required)
 *   STRIPE_WEBHOOK_SECRET_V2    - V2 event destination secret (required
 *                                 if V2 events are subscribed). Falls
 *                                 back to STRIPE_WEBHOOK_SECRET when
 *                                 unset, for setups using a single
 *                                 endpoint.
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
  const v1Secret = process.env.STRIPE_WEBHOOK_SECRET;
  const v2Secret = process.env.STRIPE_WEBHOOK_SECRET_V2 ?? v1Secret;

  if (!v1Secret) {
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

  // Try V2 thin event first against the V2 secret, then fall back to
  // V1 against the V1 secret. The two secrets may be the same (single
  // endpoint subscribed to both) or different (separate destinations
  // for V1 and V2). Either way, we attempt verification with each
  // until one succeeds.
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
    if (typeof sdkAny.parseThinEvent === "function" && v2Secret) {
      v2Thin = sdkAny.parseThinEvent(rawBody, sigHeader, v2Secret);
    }
  } catch (err) {
    lastErr = err;
  }
  if (!v2Thin) {
    try {
      v1Event = stripe.webhooks.constructEvent(rawBody, sigHeader, v1Secret);
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

// Export the raw body parser middleware and the handler so app.ts
// can register them directly with app.post() — avoids Express 5's
// router-mounting trailing-slash trap entirely.
export const stripeWebhookRawParser = express.raw({
  type: "application/json",
  limit: "1mb",
});
