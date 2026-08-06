import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  cacheHandler: import.meta.resolve("@publira/next-cache-handlers/incremental"),
  cacheHandlers: {
    default: import.meta.resolve("@publira/next-cache-handlers/use-cache"),
    remote: import.meta.resolve("@publira/next-cache-handlers/use-cache"),
  },
  cacheMaxMemorySize: 0,
  images: {
    customCacheHandler: true,
  },
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  output: "standalone",
  partialPrefetching: true,
};

export default nextConfig;
