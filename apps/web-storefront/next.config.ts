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
    // `proxy.ts` runs ahead of the webhook Route Handlers, and Next.js buffers
    // each body it sees up to this size, cutting a longer one short without an
    // error. The inbound email webhook takes a whole mail, so this sits one MiB
    // above `MAX_INBOUND_EMAIL_PAYLOAD_BYTES` in `lib/inbound-email-webhook.ts`,
    // which explains the margin.
    proxyClientMaxBodySize: "33mb",
    // A reader's icon reaches its Server Action as an image of up to 10 MiB
    // (`ACCOUNT_ICON_MAX_BYTES` in `lib/account-icon.ts`); the extra MiB holds
    // the multipart framing and the fields sent beside it.
    serverActions: {
      bodySizeLimit: "11mb",
    },
    turbopackGc: true,
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
  // `images` keeps `/_next/image` from reaching Next.js's image optimizer, so
  // the standalone output leaves out sharp, the encoder it would load.
  // Turbopack joins each pattern onto this directory and matches the absolute
  // path. pnpm keeps sharp and its `@img/*` binaries under `.pnpm/` at the
  // workspace root, and the links to sharp from `next` and from the root
  // `node_modules` would be left dangling, so they go as well.
  outputFileTracingExcludes: {
    "*": [
      "../../node_modules/**/sharp",
      "../../node_modules/.pnpm/sharp@*/**",
      "../../node_modules/.pnpm/@img+*/**",
    ],
  },
  partialPrefetching: true,
  reactCompiler: true,
  // Google's tag gateway is loaded from `/<gateway path>/` with its slash, so
  // `proxy.ts` drops a trailing slash itself, from every other path.
  skipTrailingSlashRedirect: true,
  turbopack: {
    rules: {
      // The faces `lib/open-graph-card-fonts.ts` draws the Open Graph cards
      // with, as the bytes `ImageResponse` takes rather than a URL.
      "*.woff": { condition: { query: "?bytes" }, type: "bytes" },
    },
  },
};

export default nextConfig;
