# utils

フロントエンド向けの共有ユーティリティを提供するパッケージです。

## 提供物

- `cn`: `clsx` + `tailwind-merge` を使った className 結合ヘルパー

## 使い方

```ts
import { cn } from "@publira/utils";

const className = cn(
  "rounded-md px-3 py-2",
  isActive && "bg-primary text-primary-foreground"
);
```

## ビルド

```bash
pnpm --filter @publira/utils build
```
