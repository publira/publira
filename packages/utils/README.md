# utils

フロントエンド向けの共有ユーティリティを提供するパッケージです。

## 提供物

- `cn`: `clsx` + `tailwind-merge` を使った className 結合ヘルパー
- `formatDateTime` / `toDateTimeLocalValue` / `fromDateTimeLocalValue`: テナントタイムゾーン対応の日時表示・`datetime-local` 相互変換（`Temporal` 前提）

## 使い方

```ts
import { cn } from "@publira/utils";

const className = cn(
  "rounded-md px-3 py-2",
  isActive && "bg-primary text-primary-foreground"
);
```

### 日時（テナント TZ）

実行時に `Temporal` が必要です。各アプリは `temporal-polyfill/global` を instrumentation 等で読み込みます。

```ts
import {
  DEFAULT_TIME_ZONE,
  formatDateTime,
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
} from "@publira/utils";

// 表示（timeZone 省略時は DEFAULT_TIME_ZONE = Asia/Tokyo）
formatDateTime(iso, { timeZone: "America/Los_Angeles", fallback: "-" });

// 絶対時刻 ↔ datetime-local 壁時計（ホストのローカル TZ に依存しない）
const local = toDateTimeLocalValue(iso, tenantTimeZone); // "YYYY-MM-DDTHH:mm"
const absolute = fromDateTimeLocalValue(local, tenantTimeZone); // "...Z"
```

## ビルド

```bash
pnpm --filter @publira/utils build
```
