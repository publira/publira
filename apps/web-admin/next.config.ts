import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  images: {
    remotePatterns: [
      {
        hostname: "**",
        protocol: "http",
      },
      {
        hostname: "**",
        protocol: "https",
      },
    ],
  },
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  output: "standalone",
};

export default nextConfig;
