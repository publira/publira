# SectionError

ページの一部（セクション）だけが読み込めなかったことを示すコンポーネントです。ページ全体が落ちたときの表示は各アプリの `ErrorScreen`（`error.tsx`）が担当します。

## 使用方法

```tsx
import { SectionError } from "@publira/ui-components";

export default function Example() {
  return (
    <SectionError
      description="この操作を行う権限がありません。"
      title="オペレーター一覧を表示できませんでした"
    />
  );
}
```

## sectionErrorFallback

`next/error` の `catchError` に渡すフォールバックです。再試行ボタンと `error.digest` を含む `SectionError` を描画します。`catchError` の呼び出しは各アプリの `components/section-error-catch.tsx` に置きます（このパッケージのビルドは `"use client"` を落とすため、バウンダリをここから export すると server graph で評価されてしまいます）。アプリが使うのはそれを包む `components/section-error-boundary.tsx` で、こちらは Server Component として対処の案内・再試行ボタン・エラー ID のラベルを自分でカタログから解決します。

```tsx
"use client";

import { sectionErrorFallback } from "@publira/ui-components/section-error";
import { catchError } from "next/error";

export const SectionErrorCatch = catchError(sectionErrorFallback);
```

使う側は `<Suspense>` の外側に置きます。再試行中にそのセクションのスケルトンが戻ります。

```tsx
<SectionErrorBoundary title="おすすめ作品を表示できませんでした">
  <Suspense fallback={<CardGridSkeleton />}>
    <RecommendedSeriesSection />
  </Suspense>
</SectionErrorBoundary>
```

## Subpath import

```tsx
import { SectionError } from "@publira/ui-components/section-error";
```

## Props

SectionError コンポーネントのプロップについては、実装を参照してください。
