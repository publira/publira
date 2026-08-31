# Badge

A component for status indicators and supplementary labels.

## Usage

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

See the implementation for the props of Badge and StatusChip.
