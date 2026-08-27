# Next.js cache: `cacheHandler` vs `cacheHandlers`

Shared store for self-host is **Redis** (package `@publira/next-cache-handlers`).

| Setting | Use |
| --- | --- |
| **`cacheHandlers` (plural)** | Backend for `"use cache"` / `"use cache: remote"` |
| **`cacheHandler` (singular)** | ISR, Route Handlers, `fetch` / `unstable_cache`, and **`next/image` optimized images** where `/_next/image` is in use (requires `images.customCacheHandler: true`) |

Wire **both**. With only one, the other path stays local in multi-instance deploys. Details: `packages/next-cache-handlers/README.md`.
