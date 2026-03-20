# Badge

状態表示や補助ラベルに使うコンポーネントです。

## 使用方法

```tsx
import { Badge, StatusChip } from "@publira/ui-components";

export default function Example() {
  return (
    <div className="flex gap-2">
      <Badge tone="muted" variant="outline">
        Preview
      </Badge>
      <StatusChip status="success">公開中</StatusChip>
    </div>
  );
}
```

## Subpath import

```tsx
import { Badge, StatusChip } from "@publira/ui-components/badge";
```

## Props

Badge / StatusChip の props は実装を参照してください。
