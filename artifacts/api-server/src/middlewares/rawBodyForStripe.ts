import express, { type RequestHandler } from "express";

/**
 * Stripe webhook signature verification requires the EXACT raw bytes
 * of the request body. This middleware MUST be mounted on the webhook
 * route only — never globally — because the global JSON parser would
 * otherwise consume the stream first and break signature verification.
 *
 * Usage:
 *   webhookRouter.post("/stripe", rawBodyForStripe, handleStripeWebhook);
 */
export const rawBodyForStripe: RequestHandler = express.raw({
  type: "application/json",
  limit: "1mb",
});
