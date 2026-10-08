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
    // `cacheComponents` turns this on implicitly, and its spawned prerender
    // reaches the uncached RPCs the auth screens make behind `searchParams`,
    // where the transport's `Date.now()` is refused. Lifted by #3887.
    cachedNavigations: false,
    // The `instant()` checks of the E2E suite pause request-time content
    // through this API; only the E2E build sets the variable.
    exposeTestingApiInProductionBuild:
      process.env.PUBLIRA_EXPOSE_TESTING_API === "1",
    // Unmatched URLs skip the [tenant_id] layout tree.
    globalNotFound: true,
    serverActions: {
      bodySizeLimit: "10mb",
    },
    turbopackRustReactCompiler: true,
    // Retries Next-managed navigation, prefetch, and Server Actions; not direct client requests.
    useOffline: true,
  },
  images: {
    // image-server converts and resizes through Manael, so `next/image` asks
    // it for the width it needs instead of re-encoding through
    // `/_next/image`.
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
