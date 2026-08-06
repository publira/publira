<!-- BEGIN:nextjs-agent-rules -->

# Next.js: ALWAYS read docs before coding

Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

<!-- END:nextjs-agent-rules -->

## Monorepo conventions

React Effect / `useEffectEvent` の OK・NG はリポジトリルートの [AGENTS.md](../../AGENTS.md) を参照すること。

サーバー側キャッシュは Redis（`@publira/next-cache-handlers`）。`cacheHandler`（単数・ISR/image）と `cacheHandlers`（複数形・`"use cache"`）の両方を `next.config` で有効化している。`REDIS_URL` / `NEXT_CACHE_APP` を参照。
