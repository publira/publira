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
    // Unmatched URLs skip the [tenant_id] layout tree.
    globalNotFound: true,
    serverActions: {
      bodySizeLimit: "10mb",
    },
    turbopackRustReactCompiler: true,
  },
  images: {
    // admin-image-server converts and resizes through Manael, so `next/image`
    // asks it for the width it needs instead of re-encoding through
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
