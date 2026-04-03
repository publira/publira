import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
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
