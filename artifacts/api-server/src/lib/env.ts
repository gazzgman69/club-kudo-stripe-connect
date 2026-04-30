import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z
    .string()
    .regex(/^\d+$/, "PORT must be a positive integer string")
    .transform(Number),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 chars"),

  SENTRY_DSN: z.string().url().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z
    .string()
    .regex(/^(0(\.\d+)?|1(\.0+)?)$/)
    .default("0.1")
    .transform(Number),

  CORS_ALLOWED_ORIGINS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  RATE_LIMIT_WINDOW_MS: z
    .string()
    .regex(/^\d+$/)
    .default("60000")
    .transform(Number),
  RATE_LIMIT_MAX: z
    .string()
    .regex(/^\d+$/)
    .default("100")
    .transform(Number),

  COOKIE_DOMAIN: z.string().optional(),

  // Magic-link auth (Phase 1 Step 5b).
  RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY must be set"),
  // Public base URL used to build outbound magic-link URLs. If unset,
  // derived from the request (`${req.protocol}://${req.get('host')}`).
  // Must include scheme and no trailing slash if set.
  APP_BASE_URL: z
    .string()
    .url()
    .refine((v) => !v.endsWith("/"), {
      message: "APP_BASE_URL must not end with a trailing slash",
    })
    .optional(),
  // From-header identity for outbound transactional email. Must be at a
  // Resend-verified domain (currently bookings.clubkudo.com).
  EMAIL_FROM: z
    .string()
    .default("Club Kudo <noreply@bookings.clubkudo.com>"),
  // Optional Reply-To. Leave unset to omit the header entirely.
  EMAIL_REPLY_TO: z.string().optional(),

  // Stripe Connect (Phase 1 Step 6 onwards). Optional at startup so
  // the server still boots if Stripe isn't configured yet — endpoints
  // that need it return 503 when missing.
  STRIPE_SECRET_KEY: z.string().optional(),
  // Webhook signing secret for /api/webhooks/stripe (Phase 1 Step 9).
  // Optional at startup; the webhook route 503s without it. One
  // secret is shared between V1 webhook events (account-level) and
  // V2 thin events (Connect-level) — Stripe normalises this.
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(`Environment validation failed:\n  ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
