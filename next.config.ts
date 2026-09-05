import type { NextConfig } from "next";

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "radix-ui",
      "@radix-ui/react-dialog",
      "@radix-ui/react-switch",
      "sonner",
      "react-markdown",
    ],
  },
  outputFileTracingExcludes: {
    "/*": [
      "./coverage/**/*",
      "./demo-video/**/*",
      "./docs/**/*",
      "./landing/**/*",
      "./packages/**/*",
      "./tests/**/*",
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
