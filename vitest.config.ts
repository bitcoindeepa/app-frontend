import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Date formatters use the local time zone: pin it to the members' own, so a
// test passes the same way on a laptop and on CI (UTC).
process.env.TZ = "Asia/Colombo";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Node unless a file asks for a browser with `// @vitest-environment jsdom`
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // The backend the tests talk to (see src/test/server.ts)
    env: { NEXT_PUBLIC_API_BASE_URL: "https://api.test" },
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      provider: "v8",
      // The whole app, so files without a test count as 0% instead of being left out
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts", "src/test/**"],
      // json-summary feeds the README badge (.github/workflows/tests.yml)
      reporter: ["text-summary", "json-summary"],
    },
  },
});
