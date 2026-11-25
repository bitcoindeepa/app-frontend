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
    // Logic only for now. Hooks and components will get a jsdom project.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
