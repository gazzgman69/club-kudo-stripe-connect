# Switching to Stripe Live mode

Phase 1 was built and tested entirely against Stripe **test mode**. This
document covers the work to flip the live switch.

Don't do this until:

1. End-to-end has been verified in test mode for at least one real
   wedding cycle (reservation → balance → transfer-out).
2. Your Stripe account has completed Connect activation (different from
   regular activation — needs the platform profile filled out).
3. You have at least one supplier whose Connect account is `active` in
   live mode.
4. You've reviewed the GDPR/data retention story for live PII (real
   client emails, real bank-linked supplier data).

## What changes

### Replit Secrets

Replace the test-mode values with live-mode values:

| Secret                     | Test value (current)             | Live value (target)             |
| -------------------------- | -------------------------------- | -------------------------------- |
| `STRIPE_SECRET_KEY`        | `sk_test_…`                      | `sk_live_…`                      |
| `STRIPE_PUBLISHABLE_KEY`   | `pk_test_…`                      | `pk_live_…`                      |
| `STRIPE_WEBHOOK_SECRET`    | `whsec_…` (test endpoint)        | `whsec_…` (live endpoint)        |
| `STRIPE_API_VERSION`       | unchanged                        | unchanged                        |

You will need a separate webhook endpoint in live mode:

1. Stripe Dashboard → switch to **Live mode** (top-left toggle).
2. Developers → Webhooks → "Add endpoint".
3. URL: `$REPL_URL/api/webhooks/stripe`.
4. Events to send: same set as the test endpoint (see below).
5. Copy the new signing secret into `STRIPE_WEBHOOK_SECRET`.

### Webhook event subscriptions

The handler currently dispatches on these events. Subscribe live to the
same set:

V1 webhooks (account.* etc):
- `account.updated`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`
- `charge.dispute.created`
- `charge.dispute.closed`
- `transfer.created`
- `transfer.failed`
- `transfer.reversed`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.voided`

V2 thin events (Connect onboarding, currently account.*):
- `v2.core.account.updated`

### CORS allowlist

Update `CORS_ALLOWED_ORIGINS` in Replit Secrets to the production frontend
origin(s) only. In live mode, refusing wildcard origins matters more
than in test.

### Stripe Connect platform profile

In Stripe Dashboard → Settings → Connect → Platform profile:

- Platform name: Club Kudo Ltd
- Platform website: https://clubkudo.co.uk (or wherever)
- Branding: upload logo, set primary colour
- Payout schedule: keep Stripe's default (T+2) unless you have a
  finance reason to change it
- Statement descriptor: "CLUB KUDO" (≤22 chars, ASCII upper)

The first time a supplier hits onboarding in live mode, Stripe will
collect their bank details + identity (KYC). Test-mode pre-fills don't
carry over.

### Email FROM address

Resend's default `onboarding@resend.dev` address is fine for test, but
not for live. Set up your own domain in Resend:

1. Resend → Domains → Add `clubkudo.co.uk`.
2. Set the SPF and DKIM DNS records they show you.
3. Wait for "Verified" (usually a few minutes).
4. Update `EMAIL_FROM` in Replit Secrets to e.g. `bookings@clubkudo.co.uk`.

### Sentry environment

Set `SENTRY_ENVIRONMENT=production` in Replit Secrets so live errors
don't get mixed in with test.

## What to test before flipping

A scripted cutover, in order:

1. **Health check** — `/api/healthz` returns 200 with new secrets loaded.
2. **Sign-in** — Magic-link to `skinnycheck@gmail.com` works against the
   live email transport.
3. **Create a fake supplier** — Onboard them with your own Stripe
   account in test mode of *their* account (Stripe Connect supports
   nested test mode for sandbox testing in live).

   Actually safer: do a tiny real transaction (£1) end-to-end with a
   supplier whose bank you control. Refund it after.

4. **Webhook signature** — Use Stripe CLI to send a `payment_intent.
   succeeded` test event to the live endpoint and confirm 200.

## What can go wrong

- **Mixed test + live IDs in DB.** When you switch, existing rows will
  reference test-mode `acct_…`, `pi_…`, `evt_…`. The cleanest reset is
  to truncate `suppliers`, `clients`, `gigs`, `invoices`, `transfers`,
  `audit_log` and start fresh in live. If you can't, leave the test
  rows alone and just create new ones; they won't collide because the
  unique constraints are on Stripe IDs which differ between modes.

- **Forgetting to flip the dashboard toggle.** If you change the
  webhook endpoint while still in test mode, you've added it to the
  test environment, not live. The Stripe dashboard's mode toggle is
  global and easy to miss.

- **Connect activation pending.** Live-mode account creation will
  return a `404` or `account.application.active = false` if your
  platform isn't yet activated for Connect. Stripe's email confirming
  activation is the green light.

## Rolling back to test

If something goes wrong post-cutover, revert the Replit Secrets to the
test values you saved (keep them in a password manager — DON'T leave
them in `.cowork-credentials/credentials.env` as a backup, that file
gets sourced into shells), then redeploy.

The DB is mode-agnostic — Stripe-test-IDs and Stripe-live-IDs coexist
without schema changes.
