import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
    // Tests must not depend on a real database or Redis. The setup file
    // populates dummy env vars so module-load-time `getEnv()` calls in
    // app code (e.g. csrf.ts) pass schema validation. Test files mock
    // any actual data dependencies via `vi.mock`.
    setupFiles: ["./src/test-setup.ts"],
    pool: "threads",
  },
});
