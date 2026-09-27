import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  // `BUILD_STANDALONE=1 npm run build` produces a self-contained server in .next/standalone
  // (used for container deployment and for the local browser checks).
  ...(process.env.BUILD_STANDALONE === "1" ? { output: "standalone" as const } : {}),
};

export default config;
