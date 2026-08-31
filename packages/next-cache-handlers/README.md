# `@publira/next-cache-handlers`

The shared package that puts **both** of Next.js's server caches on Redis. It is the source of truth for sharing a cache across a self-hosted, multi-instance deploy.

| Setting | What it covers | Export |
| --- | --- | --- |
| **`cacheHandlers` (plural)** | `"use cache"` / `"use cache: remote"` | `@publira/next-cache-handlers/use-cache` |
| **`cacheHandler` (singular)** | ISR, Route Handlers, `fetch` / `unstable_cache`, and **`next/image` when it uses the built-in optimizer** | `@publira/next-cache-handlers/incremental` |

> **Easy to confuse:** with only `cacheHandlers`, the ISR family stays local. Wire both. `images.customCacheHandler: true` matters only to an app that uses the built-in `/_next/image`; in `web-host` and `web-admin`, which set `images.loader: "custom"`, `/_next/image` itself returns a 404.

## Environment variables

| Variable | Description |
| --- | --- |
| `PUBLIRA_REDIS_URL` | The Redis connection URL (default `redis://localhost:6379`). `disabled` / `off` / `false` / an empty string turns it off (always a miss) |
| `PUBLIRA_CACHE_APP` | The app name in the key prefix (default `next` → `publira:{app}:`) |
| `PUBLIRA_CACHE_KEY_PREFIX` | Overrides the whole prefix |
| `PUBLIRA_REDIS_CACHE_TIMEOUT_MS` | The command timeout in ms (default `1000`) |

During `next build` (`NEXT_PHASE=phase-production-build`) it does not connect to Redis.

## Wiring it in next.config

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  cacheHandler: import.meta.resolve("@publira/next-cache-handlers/incremental"),
  cacheHandlers: {
    default: import.meta.resolve("@publira/next-cache-handlers/use-cache"),
    remote: import.meta.resolve("@publira/next-cache-handlers/use-cache"),
  },
  cacheMaxMemorySize: 0,
  // Only for an app that uses the built-in `/_next/image`.
  images: {
    customCacheHandler: true,
  },
  output: "standalone",
};

export default nextConfig;
```

Give each app its own `PUBLIRA_CACHE_APP` (`web-host`, and so on) to separate the key space.

## Behavior on failure

- Redis down or timing out: **one warning, then a miss on get and a no-op on set** (the app keeps running)
- Redis is required for a multi-instance production deploy. In the Dev Container, use the `redis` service

## Choosing a `"use cache"` directive

| Directive | Handler | What it is for |
| --- | --- | --- |
| `"use cache"` | `cacheHandlers.default` | The ordinary shared data cache (Redis, in this package) |
| `"use cache: remote"` | `cacheHandlers.remote` | The same (in this repository, the same Redis as default) |
| `"use cache: private"` | Not configurable | Request-specific; no handler applies |

To raise the multi-instance hit rate for public data, prefer `"use cache: remote"` (it means something once the handler is Redis).

## References

- [cacheHandler (singular)](https://nextjs.org/docs/app/api-reference/config/next-config-js/incrementalCacheHandlerPath)
- [cacheHandlers (plural)](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheHandlers)
- Issue #532
