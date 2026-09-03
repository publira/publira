# `@publira/next-cache-handlers`

The shared package that puts **both** of Next.js's server caches on Redis. It is the source of truth for sharing a cache across a self-hosted, multi-instance deploy.

| Setting | What it covers | Export |
| --- | --- | --- |
| **`cacheHandlers` (plural)** | `"use cache"` / `"use cache: remote"` | `@publira/next-cache-handlers/use-cache` |
| **`cacheHandler` (singular)** | ISR, Route Handlers, `fetch` / `unstable_cache`, and **`next/image` when it uses the built-in optimizer** | `@publira/next-cache-handlers/incremental` |

Wire both: with only `cacheHandlers`, the ISR family stays local in a multi-instance deploy.

## Environment variables

| Variable | Description |
| --- | --- |
| `PUBLIRA_REDIS_URL` | The Redis connection URL (default `redis://localhost:6379`). `disabled` / `off` / `false` / an empty string turns it off (always a miss) |
| `PUBLIRA_CACHE_APP` | The app name in the key prefix (default `next` → `publira:{app}:`) |
| `PUBLIRA_CACHE_KEY_PREFIX` | Overrides the whole prefix |
| `PUBLIRA_REDIS_CACHE_TIMEOUT_MS` | The command timeout in ms (default `1000`) |

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
  // Only for an app that uses the built-in `/_next/image`. `web-host` and
  // `web-admin` set `images.loader: "custom"`, so `/_next/image` 404s there
  // and this setting means nothing to them.
  images: {
    customCacheHandler: true,
  },
  output: "standalone",
};

export default nextConfig;
```

Give each app its own `PUBLIRA_CACHE_APP` (`web-host`, and so on) to separate the key space.

## Behavior on failure

Redis being down, disabled, or timing out is a miss on get and a no-op on set, so the app keeps running (`src/redis-client.ts`). It is still required for a multi-instance production deploy; in the Dev Container, use the `redis` service.

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
