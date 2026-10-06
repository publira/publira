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
    // `cacheComponents` turns this on implicitly, and with the async Redis
    // `cacheHandlers` its spawned prerender races their pending reads
    // (vercel/next.js#98543).
    cachedNavigations: false,
    // Unmatched URLs skip the [tenant_id] layout tree.
    globalNotFound: true,
    // `proxy.ts` runs ahead of the webhook Route Handlers, and Next.js buffers
    // each body it sees up to this size, cutting a longer one short without an
    // error. The inbound email webhook takes a whole mail, so this sits one MiB
    // above `MAX_INBOUND_EMAIL_PAYLOAD_BYTES` in `lib/inbound-email-webhook.ts`,
    // which explains the margin.
    proxyClientMaxBodySize: "33mb",
    turbopackRustReactCompiler: true,
    // Retries Next-managed navigation, prefetch, and Server Actions; not direct client requests.
    useOffline: true,
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
