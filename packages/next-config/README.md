# next-config

Next.js 向けの共通設定ヘルパーを提供するパッケージです。

## 提供物

- `withMicrofrontends(nextConfig, { appName })`

`assetPrefix` や image path、rewrite をマイクロフロントエンド向けに補正します。

## 使い方

```ts
import type { NextConfig } from "next";
import { withMicrofrontends } from "@publira/next-config";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default withMicrofrontends(nextConfig, {
  appName: "web-admin",
});
```

## ビルド

```bash
pnpm --filter @publira/next-config build
```
