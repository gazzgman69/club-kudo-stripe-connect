import Stripe from "stripe";
import { getEnv } from "./env";
import { HttpError } from "../middlewares/errorHandler";

let cached: Stripe | null = null;

/**
 * Lazy singleton Stripe client. Throws an HttpError(503) if
 * STRIPE_SECRET_KEY isn't configured — handlers that depend on Stripe
 * should let the error propagate so the global error handler returns
 * a clean JSON response.
 *
 * Note on V2 API: the `stripe` SDK exposes V2 endpoints via
 * `stripe.v2.core.accounts.create(...)`. We don't pin an apiVersion
 * here — the SDK uses the default for the account, which is what
 * Stripe themselves recommend for Connect platforms.
 */
export function getStripe(): Stripe {
  if (cached) return cached;
  const env = getEnv();
  if (!env.STRIPE_SECRET_KEY) {
    throw new HttpError(
      503,
      "stripe_not_configured",
      "Stripe integration is not configured (STRIPE_SECRET_KEY missing)",
    );
  }
  cached = new Stripe(env.STRIPE_SECRET_KEY, {
    appInfo: {
      name: "club-kudo-stripe-connect",
      version: "0.0.0",
    },
  });
  return cached;
}

// Test-only helper: reset the cached client between tests so a
// changed env var is picked up. Not exported from the public surface.
export function _resetStripeCacheForTests(): void {
  cached = null;
}
