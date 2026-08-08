# utils

フロントエンド向けの共有ユーティリティを提供するパッケージです。

## 提供物

- `cn`: `clsx` + `tailwind-merge` を使った className 結合ヘルパー
- `formatDateTime` / `formatDate` / `toDateTimeLocalValue` / `fromDateTimeLocalValue`: テナントタイムゾーン対応の日時・日付表示、`datetime-local` 相互変換（`Temporal` 前提）
- `parseInstant` / `toInstantIsoString` / `startOfDayIsoString` / `endOfDayIsoString`: 絶対時刻のパース・比較、フォーム値の正規化、date-only フィルタの日境界

## 使い方

```ts
import { cn } from "@publira/utils";

const className = cn(
  "rounded-md px-3 py-2",
  isActive && "bg-primary text-primary-foreground"
);
```

### 日時（テナント TZ）

実行時に `Temporal` が必要です。各アプリは `temporal-polyfill/global` を instrumentation 等で読み込みます。絶対時刻のパースは `Temporal.Instant.from` のみ（`Z` または数値オフセット必須）。ホストローカルの `Date.parse` は使いません。

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
// fromDateTimeLocalValue は Z / オフセット / [IANA] 付き文字列を拒否する
```

### パース・比較・日境界

```ts
import {
  endOfDayIsoString,
  parseInstant,
  startOfDayIsoString,
  toInstantIsoString,
} from "@publira/utils";

// 比較・ソートは Instant で行う（getTime() の連鎖や文字列比較を使わない）
const at = parseInstant(apiTimestamp); // Temporal.Instant | null
if (at && Temporal.Instant.compare(at, Temporal.Now.instant()) <= 0) {
  /* 過去 */
}

// server action の入力（絶対時刻でも datetime-local 壁時計でも受ける）
toInstantIsoString(formValue, tenantTimeZone); // "...Z" / 解釈できなければ ""

// date-only フィルタの日境界（UTC 決め打ちにしない）
startOfDayIsoString("2024-03-10", tenantTimeZone); // その TZ の 00:00
endOfDayIsoString("2024-03-10", tenantTimeZone); // 同日の終端（inclusive）
```

## ビルド

```bash
pnpm --filter @publira/utils build
```
