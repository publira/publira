import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  output: "standalone",
  partialPrefetching: true,
};

export default nextConfig;
