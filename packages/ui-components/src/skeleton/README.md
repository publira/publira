# Skeleton

ローディング状態を表示するためのコンポーネントです。

## 使用方法

```tsx
import { Skeleton, SkeletonCard, SkeletonText } from "@publira/ui-components";

export default function Example() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-5 w-48" />
      <SkeletonText lines={3} />
      <SkeletonCard />
    </div>
  );
}
```

### 行内で使う場合は `SkeletonLine`

`Skeleton` は `<div>` なので、見出しやボタン行の中に差し込むと行内フローが崩れます。`<Suspense>` の fallback を見出しやアクションの位置に置くときは `<span>` ベースの `SkeletonLine` を使ってください。

```tsx
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

<AdminPageTitle>
  <Suspense fallback={<SkeletonLine className="h-7 w-64" />}>
    <EditLabelTitle searchParams={searchParams} />
  </Suspense>
</AdminPageTitle>;
```

## Subpath import

```tsx
import {
  Skeleton,
  SkeletonCard,
  SkeletonLine,
  SkeletonText,
} from "@publira/ui-components/skeleton";
```

## Props

Skeleton 系コンポーネントの props は実装を参照してください。
