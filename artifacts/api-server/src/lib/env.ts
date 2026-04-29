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
