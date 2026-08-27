import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Singular: ISR / Route Handler / fetch / unstable_cache.
  cacheHandler: import.meta.resolve("@publira/next-cache-handlers/incremental"),
  // Plural: "use cache" / "use cache: remote" → same Redis store.
  cacheHandlers: {
    default: import.meta.resolve("@publira/next-cache-handlers/use-cache"),
    remote: import.meta.resolve("@publira/next-cache-handlers/use-cache"),
  },
  // Prefer Redis over the default in-process memory tier.
  cacheMaxMemorySize: 0,
  experimental: {
    // `assertSameOrigin()` terminates rejected Server Actions with Next's 403.
    authInterrupts: true,
    // Unmatched URLs skip the [tenant_id] layout tree.
    globalNotFound: true,
    turbopackRustReactCompiler: true,
  },
  images: {
    // image-server converts and resizes through Manael, so `next/image` asks it
    // for the width it needs instead of re-encoding through `/_next/image`.
    loader: "custom",
    loaderFile: "./lib/image-loader.ts",
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
