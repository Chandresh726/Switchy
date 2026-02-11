import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ai-sdk-provider-gemini-cli", "@google/gemini-cli-core", "node-pty"],
};

export default nextConfig;
