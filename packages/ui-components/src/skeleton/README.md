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

## Subpath import

```tsx
import {
  Skeleton,
  SkeletonCard,
  SkeletonText,
} from "@publira/ui-components/skeleton";
```

## Props

Skeleton 系コンポーネントの props は実装を参照してください。
