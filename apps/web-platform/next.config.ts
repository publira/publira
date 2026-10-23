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
    // Retries Next-managed navigation, prefetch, and Server Actions; not direct client requests.
    useOffline: true,
  },
  images: {
    // The console renders no `next/image`, so `/_next/image` answers 404 here
    // as it does on the consoles whose loader is custom.
    unoptimized: true,
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
