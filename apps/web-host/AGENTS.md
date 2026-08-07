<!-- BEGIN:nextjs-agent-rules -->

# Next.js: ALWAYS read docs before coding

Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

<!-- END:nextjs-agent-rules -->

## Monorepo conventions

For React Effect / `useEffectEvent` OK and NG rules, see the repository root [AGENTS.md](../../AGENTS.md).

Server-side cache uses Redis (`@publira/next-cache-handlers`). Both `cacheHandler` (singular: ISR/image) and `cacheHandlers` (plural: `"use cache"`) are enabled in `next.config`. See `REDIS_URL` / `NEXT_CACHE_APP`.
