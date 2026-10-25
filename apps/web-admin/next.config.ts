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
    // The console's image uploads reach their Server Actions as an image of up
    // to 10 MiB: a branding image (`BRANDING_IMAGE_MAX_BYTES` in
    // `branding/_lib/actions.ts`), and an eye-catch or an author icon, which
    // publira server holds to the same size. Both limits below apply to the
    // whole body, so each sits one MiB above the image to hold the multipart
    // framing and the fields sent beside it. `proxy.ts` runs ahead of those
    // pages, and Next.js buffers each body it sees up to
    // `proxyClientMaxBodySize`, cutting a longer one short without an error,
    // so that limit has to admit the same body as the Server Action's.
    proxyClientMaxBodySize: "11mb",
    serverActions: {
      bodySizeLimit: "11mb",
    },
    turbopackGc: true,
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
};

export default nextConfig;
