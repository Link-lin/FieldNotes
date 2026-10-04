import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const serverOnly = fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url));

// next-auth imports "next/server" without its extension, which Node alone can't resolve (Next's bundler can).
// Tests that load it (the sign-in flow) have vite process next-auth and point that import at the real file.
const nextServer = fileURLToPath(new URL("./node_modules/next/server.js", import.meta.url));
const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)), "server-only": serverOnly, "next/server": nextServer };

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
          server: { deps: { inline: ["next-auth"] } },
        },
      },
    ],
  },
});
