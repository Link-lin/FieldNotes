import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const serverOnly = fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url));

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)), "server-only": serverOnly };

export default defineConfig({
  resolve: { alias },
  test: {
    env: { TZ: "America/New_York" },
    fileParallelism: false,
    projects: [
      { resolve: { alias }, test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" } },
      {
        resolve: { alias },
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/db/global-setup.ts"],
          setupFiles: ["tests/db/setup.ts"],
          testTimeout: 30000,
          hookTimeout: 120000,
        },
      },
    ],
  },
});
