# `@publira/next-cache-handlers`

Redis 上に Next.js の **2 系統**のサーバーキャッシュを載せる共有パッケージです。self-host / multi-instance でキャッシュを共有するための正本です。

| 設定 | 用途 | export |
| --- | --- | --- |
| **`cacheHandlers`（複数形）** | `"use cache"` / `"use cache: remote"` | `@publira/next-cache-handlers/use-cache` |
| **`cacheHandler`（単数）** | ISR・Route Handler・`fetch` / `unstable_cache`・**`next/image` 最適化結果** | `@publira/next-cache-handlers/incremental` |

> **混同注意:** `cacheHandlers` だけだと `next/image` や ISR 系はローカルのままです。両方と `images.customCacheHandler: true` を配線してください。

## 環境変数

| 変数 | 説明 |
| --- | --- |
| `PUBLIRA_REDIS_URL` | Redis 接続 URL（既定 `redis://localhost:6379`）。`disabled` / `off` / `false` / 空文字で無効化（常に miss） |
| `PUBLIRA_CACHE_APP` | キープレフィックスの app 名（既定 `next` → `publira:{app}:`） |
| `PUBLIRA_CACHE_KEY_PREFIX` | プレフィックス全体を上書き |
| `PUBLIRA_REDIS_CACHE_TIMEOUT_MS` | コマンドタイムアウト ms（既定 `1000`） |

`next build` 中（`NEXT_PHASE=phase-production-build`）は Redis に接続しません。

## next.config 配線例

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
  images: {
    customCacheHandler: true,
  },
  output: "standalone",
};

export default nextConfig;
```

アプリごとに `PUBLIRA_CACHE_APP=web-host`（など）を付け、キー空間を分離してください。

## 障害時の挙動

- Redis 未起動・タイムアウト: **warn を一度出し、get は miss / set は no-op**（アプリ起動は継続）
- 本番 multi-instance では Redis 必須。devcontainer の `redis` サービスを利用する

## `"use cache"` の使い分け

| ディレクティブ | ハンドラ | 用途 |
| --- | --- | --- |
| `"use cache"` | `cacheHandlers.default` | 通常の共有 data cache（本パッケージでは Redis） |
| `"use cache: remote"` | `cacheHandlers.remote` | 同上（本リポジトリでは default と同じ Redis） |
| `"use cache: private"` | 設定不可 | リクエスト固有。ハンドラ対象外 |

公開データの multi-instance ヒット率を上げたい場合は `"use cache: remote"` を優先する（handler が Redis のとき意味がある）。

## 関連

- [cacheHandler (singular)](https://nextjs.org/docs/app/api-reference/config/next-config-js/incrementalCacheHandlerPath)
- [cacheHandlers (plural)](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheHandlers)
- Issue #532
