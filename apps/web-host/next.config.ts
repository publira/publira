import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Singular: ISR / Route Handler / fetch / next/image (with customCacheHandler).
  cacheHandler: import.meta.resolve("@publira/next-cache-handlers/incremental"),
  // Plural: "use cache" / "use cache: remote" → same Redis store.
  cacheHandlers: {
    default: import.meta.resolve("@publira/next-cache-handlers/use-cache"),
    remote: import.meta.resolve("@publira/next-cache-handlers/use-cache"),
  },
  // Prefer Redis over the default in-process memory tier.
  cacheMaxMemorySize: 0,
  experimental: {
    // Unmatched URLs skip the [tenant_id] layout tree.
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
