import path from "node:path";

import type { NextConfig } from "next";

const invocationRoot = process.env.INIT_CWD ?? process.env.PWD ?? process.cwd();
// Keep pnpm's shared Next.js package reachable without inheriting root-app entries.
const root = path.basename(invocationRoot) === "landing"
  ? path.dirname(invocationRoot)
  : invocationRoot;

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  turbopack: { root },
};

export default nextConfig;
