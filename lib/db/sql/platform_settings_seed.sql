-- Ensure the platform_settings singleton row exists. Idempotent —
-- runs after every drizzle-kit push but only inserts the first time.
-- Once the row exists, admin updates via PATCH /api/admin/platform-settings
-- are preserved across pushes.

INSERT INTO platform_settings (
  id,
  vat_registered,
  vat_rate_bps,
  default_reservation_percent_bps,
  default_booking_commission_percent_bps,
  currency,
  default_invoice_payment_terms_days,
  cancellation_policy_text
) VALUES (
  'singleton',
  TRUE,
  2000,
  2500,
  NULL,
  'gbp',
  14,
  NULL
)
ON CONFLICT (id) DO NOTHING;
