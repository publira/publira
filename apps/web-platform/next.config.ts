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
    // `assertSameOrigin()` terminates rejected Server Actions with Next's 403.
    authInterrupts: true,
    // Unmatched URLs skip normal layout rendering.
    globalNotFound: true,
    turbopackRustReactCompiler: true,
  },
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
  reactCompiler: true,
};

export default nextConfig;
