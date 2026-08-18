# utils

フロントエンド向けの共有ユーティリティを提供するパッケージです。

## 提供物

- `cn`: `clsx` + `tailwind-merge` を使った className 結合ヘルパー
- `formatDateTime` / `formatDate` / `toDateTimeLocalValue` / `fromDateTimeLocalValue`: テナントタイムゾーン対応の日時・日付表示、`datetime-local` 相互変換（`Temporal` 前提）
- `parseInstant` / `toInstantIsoString` / `startOfDayIsoString` / `endOfDayIsoString`: 絶対時刻のパース・比較、フォーム値の正規化、date-only フィルタの日境界
- `listSupportedTimeZones` / `isValidTimeZone`: テナントタイムゾーン設定 UI 向けの IANA タイムゾーン一覧と検証
- `@publira/utils/search-params`: `searchParams`（`string | string[] | undefined`）を zod で検証するためのスキーマ生成関数
- `@publira/utils/form-data`: `FormData` を zod の検証対象オブジェクトへ変換するヘルパー
- `@publira/utils/field-errors`: `safeParse` の失敗を Server Action の ActionState 形状へ落とすヘルパー
- `@publira/utils/cached-read`: `"use cache"` の読み取りで失敗を「値」として返し、その失敗をキャッシュに残さないためのヘルパー
- `@publira/utils/i18n`: ロケール判定と、動的 `import()` したメッセージカタログからキーに一致する文字列を返すヘルパー
- `@publira/utils/image-loader`: `next/image` から image-server (Manael) の変換・縮小を使うためのカスタムローダー

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

// 表示（テナント向けは getTenantDisplayTimeZone の値を渡す。省略時は DEFAULT_TIME_ZONE）
// locale は UI ロケール。省略時は ja（従来の ja-JP 固定と同じ出力）
formatDateTime(iso, { locale, timeZone: tenantTimeZone, fallback: "-" });

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

### タイムゾーンの選択と検証

テナントタイムゾーン設定（[#565](https://github.com/publira/publira/issues/565)）のように、IANA 名を選ばせて保存する画面向けのヘルパーです。

```ts
import { isValidTimeZone, listSupportedTimeZones } from "@publira/utils";

// 選択肢（ランタイムの ICU が持つゾーン名 + UTC、名前順・メモ化済み）
const items = listSupportedTimeZones().map((zone) => ({
  label: zone,
  value: zone,
}));

// Server Action の zod スキーマで即時フィードバックに使う
const schema = z.object({
  timezone: z.string().trim().min(1).refine(isValidTimeZone),
});
```

正本は Go サーバ（`server/internal/tenanttz`、埋め込み IANA tzdata で検証）です。`isValidTimeZone` はそこを緩めないための前段チェックで、`Local` とオフセット表記（`+09:00`）は `time.LoadLocation` に合わせて拒否します。列挙されないエイリアス（`Asia/Calcutta`）は有効値として受け付けます。

## 信頼できない入力の検証（zod）

方針は [`apps/AGENTS.md`](../../apps/AGENTS.md) の「Untrusted input」を参照。ここにあるのは、その方針を 3 アプリで同じ書き方にするための共有スキーマです。zod は peerDependency なので、アプリ側の zod がそのまま使われます。

### `searchParams`

`fallback` を渡すと「絶対に失敗しないスキーマ」、渡さないと「不正な値で zod エラーになるスキーマ」になります。前者はフィルタ画面の既定表示へのフォールバック、後者は `notFound()` させたい URL 向けです。

```ts
import {
  searchParamDate,
  searchParamEnum,
  searchParamNumber,
  searchParamString,
} from "@publira/utils/search-params";
import { z } from "zod";

const filtersSchema = z.object({
  from: searchParamDate({ fallback: "" }), // 暦上ありえない日付は "" に落ちる
  limit: searchParamNumber({ clamp: true, fallback: 20, max: 50, min: 1 }),
  q: searchParamString({ fallback: "", maxLength: 255 }),
  sort: searchParamEnum(["asc", "desc"], { fallback: "desc" }),
});

const filters = filtersSchema.parse(await searchParams);
```

- 単一値のスキーマは同じキーが複数回現れた場合、どれか 1 つを選ばず不正扱いにする（`fallback` があればそれに落ちる）
- 複数値は `searchParamStringArray()`。単一の `?tag=a` も 1 要素の配列として受ける
- `searchParamNumber` は 10 進の整数・小数だけを受ける（`0x10` / `1e3` / `Infinity` は不正）。`integer` は既定で `true`
- `maxLength` 超過は既定で不正。`truncate: true` のときだけ切り詰める（サロゲートペアは割らない）
- `searchParamDate` は `Temporal` で暦の妥当性まで見るため、実行時に polyfill が必要

実例: [`web-admin` の監査ログフィルタ](../../apps/web-admin/app/%5Btenant_id%5D/%28protected%29/audit-logs/_lib/search-params.ts)

### `FormData` と Server Action

`toFormDataInput` は「テキスト / 繰り返しテキスト / ファイル / 繰り返しファイル」を宣言して読み出すだけで、trim も長さ制限も行いません。フォームが何を受け付けるかは zod スキーマ 1 か所に置きます。

```ts
import {
  toFieldErrors,
  VALIDATION_ERROR_MESSAGE,
} from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";

const parsed = seriesSchema.safeParse(
  toFormDataInput(formData, {
    creatorPublicIds: { kind: "values", name: "creator_public_ids" },
    eyeCatchImage: { kind: "file", name: "eye_catch_image" },
    title: "value",
  })
);

if (!parsed.success) {
  return {
    fieldErrors: toFieldErrors(parsed.error),
    message: VALIDATION_ERROR_MESSAGE,
    ok: false,
  };
}
```

- `value` はファイルが送られてきても文字列化せず `undefined`（`String(formData.get(...))` が `"[object File]"` を作る事故を防ぐ）
- 未入力の `<input type="file">` は 0 バイトのエントリを送るため、ファイル系は空ファイルを落とす
- ActionState にフィールド単位の枠がない画面は `toFormErrorMessage(parsed.error)` で 1 本のメッセージにする

## `"use cache"` の失敗（`cached-read`）

Cache Components 下の production ビルドで実測（[#672](https://github.com/publira/publira/issues/672)）: **`"use cache"` のキャッシュ充填が throw すると、そのリクエスト自体が失敗する。** 呼び出し側の `try` / `catch` でも、外側のキャッシュ関数で受けても救えず、static shell が commit 済みのときだけクライアント側のエラーバウンダリが拾える。したがって cached read は **throw せず、失敗を値として返す**。

```ts
import {
  cachedReadFailure,
  dropFailedCacheEntry,
} from "@publira/utils/cached-read";
import type { CachedReadResult } from "@publira/utils/cached-read";

export const getSeriesDetail = async (
  tenantId: string,
  publicId: string
): Promise<CachedReadResult<SeriesDetail | null>> => {
  "use cache";
  try {
    const response = await apiClient.catalog.getSeriesDetail({
      publicId,
      tenant: { tenantId },
    });
    return { ok: true, value: toSeriesDetail(response) };
  } catch (error) {
    if (isMissingResourceRpcError(error)) {
      // 「無い」は答えであり、キャッシュしてよい
      return { ok: true, value: null };
    }
    return cachedReadFailure(
      rpcErrorMessage(error, "シリーズを取得できませんでした。")
    );
  }
};

// 見せるメッセージが無い chrome 用の読み取りは、既定値に落として entry だけ捨てる
export const getTenantSiteInfo = async (
  tenantId: string
): Promise<TenantSiteInfo | null> => {
  "use cache";
  try {
    return toTenantSiteInfo(
      await apiClient.tenant.getTenant({ tenant: { tenantId } })
    );
  } catch (error) {
    if (!isExpectedNullableRpcError(error)) {
      dropFailedCacheEntry();
    }
    return null;
  }
};
```

- `cachedReadFailure` / `dropFailedCacheEntry` は `cacheLife({ expire: 0, revalidate: 0, stale: 0 })` を設定し、**失敗をキャッシュに載せない**（`@publira/next-cache-handlers` の `set` は `expire === 0` を保存せず、仮に保存されても `revalidate: 0` で次回 miss になる）。復旧後の再読み込みは即座に通常の内容を返す
- `next.config.ts` の名前付きプロファイルには `expire > revalidate` や `stale` 最小値の検証があるが、`cacheLife()` の**インライン呼び出しには検証がない**（`next/dist/server/use-cache/cache-life.js` は明示値を記録するだけ）。この 3 値の組み合わせは #672 で production ビルド上の実測により、エラーを出さず、失敗が保存されないことを確認している
- エラーの分類はキャッシュスコープの**内側**で行う。`"use cache"` 境界を越えたエラーは production で message が digest に置き換わり、`Code`（`rpcErrorDisposition()` / `rpcErrorMessage()`）が失われる
- 呼び出し側は `ok: false` を `SectionError` / `PageLoadError` として描画する。画面側の使い分けは `apps/AGENTS.md`

## ロケールとメッセージ（`i18n`）

i18n ライブラリは使いません。Server Components がロケールごとの JSON を動的 `import()` し、キーに一致した文字列を返します。カタログの正本はリポジトリルートの [`locales/`](../../locales/README.md) です。Go と Flutter も同じ JSON を読みます。

Cookie や `next/root-params` の読み取りはこのパッケージにはありません。アプリが値を渡し、共有層は「受け取った値でカタログを返す」までです。`"use cache"` の中から呼ぶときは locale を引数で渡してください。

```ts
import {
  getMessage,
  loadMessages,
  LOCALE_COOKIE_NAME,
  parseLocaleCookie,
  type ExactCatalog,
  type Locale,
} from "@publira/utils/i18n";
import en from "../../locales/en.json";
import ja from "../../locales/ja.json";

export type Messages = typeof ja;

// ja が型の正。JSON import はオブジェクトリテラルではないので
// `satisfies Messages` では余剰キーを拾えない。ExactCatalog を使う。
const _en: ExactCatalog<typeof en, Messages> = en;

const loadCatalog = (locale: Locale) =>
  loadMessages<Messages>(locale, {
    // テンプレート文字列の動的パスは使わない（全ロケールが束ねられる）
    en: () => import("../../locales/en.json"),
    ja: () => import("../../locales/ja.json"),
  });

const locale = parseLocaleCookie(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
const catalog = await loadCatalog(locale);
const label = getMessage(catalog, "locale.ja");
const greeting = getMessage(catalog, "greeting", { name: "山田" });
```

- 未知のロケール文字列は `ja` に落ちる（`parseLocale` / `parseLocaleCookie`）
- Cookie 名定数は `LOCALE_COOKIE_NAME`（`publira_locale`）。`cookies()` は呼ばない
- 存在するキーは一致した文字列を返し、`{name}` だけを補間する
- 未知キーは開発時に throw、本番ではキーをそのまま返す
- TypeScript のカタログモジュールを手で書く場合は、`export default { … } satisfies Messages` でも欠け・余剰を型エラーにできる

## `next/image` のローダー（`image-loader`）

`imageServerLoader` は `next/image` の custom loader です。`/images/...`（image-server / admin-image-server）を読むときだけ、Manael が解釈するクエリを組み立てます。

```ts
// apps/web-host/lib/image-loader.ts
"use client";

export { imageServerLoader as default } from "@publira/utils/image-loader";
```

```ts
// apps/web-host/next.config.ts
images: {
  loader: "custom",
  loaderFile: "./lib/image-loader.ts",
},
```

`images.loaderFile` はアプリルートからの相対パスしか受け付けず、`import.meta.resolve` で解決したパッケージを渡せません。各アプリに再エクスポートだけを置き、実装はこのパッケージに置いています。

| 入力 | 出力 |
| --- | --- |
| `/images/creators/<uuid>`、幅 96 | `/images/creators/<uuid>?w=96&fit=scale-down` |
| 同上、`quality={60}` 指定あり | `…?w=96&fit=scale-down&q=60` |
| `blob:` / `data:` / 絶対 URL / その他のパス | そのまま返す |

- `fit=scale-down` は原寸より大きくしないための指定です。`next/image` は `deviceSizes` の全幅（最大 3840px）を要求するので、Manael の既定（`contain`、拡大あり）では小さなアイコンが 3840px に引き伸ばされます。
- `q` は呼び出し側が `quality` を指定したときだけ付けます。`next/image` は `quality` プロップが無いとローダーに `undefined` を渡すので（Next.js 16.3 の `get-img-props`）、無指定のときは Manael のフォーマット別既定（WebP 90 / AVIF 60）が効きます。
- `quality` を指定する場合は、その値を各アプリの `images.qualities` にも足してください。既定は `[75]` で、外れた値は開発時に警告が出ます（custom loader なので値そのものはローダーまで届きます）。
- WebP / AVIF の選択はブラウザの `Accept` によるので、ローダーは形式を指定しません。
- `blob:` の一時プレビューなど image-server を経由しない `<Image>` は、そのまま `unoptimized` を付けたままにします。

## ビルド

```bash
pnpm --filter @publira/utils build
```
