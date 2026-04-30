// Vitest setup. Runs before any test module is imported, so it must
// satisfy every module-load-time env check in the production codebase
// (e.g. csrf.ts calls `getEnv()` at module load, which validates
// SESSION_SECRET length, REDIS_URL format, etc.).
//
// These values are dummies — tests that exercise real env-driven
// behaviour should override them per-test or mock the relevant module.
process.env.NODE_ENV = "test";
process.env.PORT ??= "8080";
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.SESSION_SECRET ??=
  "test-session-secret-must-be-at-least-32-characters-long";
