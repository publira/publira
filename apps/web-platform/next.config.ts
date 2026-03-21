import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: false,
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
};

export default nextConfig;
