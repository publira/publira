import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  cacheHandler: import.meta.resolve("@publira/next-cache-handlers/incremental"),
  cacheHandlers: {
    default: import.meta.resolve("@publira/next-cache-handlers/use-cache"),
    remote: import.meta.resolve("@publira/next-cache-handlers/use-cache"),
  },
  cacheMaxMemorySize: 0,
  experimental: {
    // Unmatched URLs skip the [tenant_id] layout tree.
    globalNotFound: true,
    serverActions: {
      bodySizeLimit: "10mb",
    },
    turbopackRustReactCompiler: true,
  },
  images: {
    customCacheHandler: true,
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
  partialPrefetching: true,
  reactCompiler: true,
};

export default nextConfig;
