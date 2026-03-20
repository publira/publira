# Dialog

確認操作や詳細表示に利用するダイアログコンポーネントです。

## 使用方法

```tsx
import { Button } from "@publira/ui-components/button";
import { ConfirmDialog } from "@publira/ui-components/dialog";

export default function Example() {
  return (
    <ConfirmDialog
      actionText="削除する"
      description="この操作は取り消せません。"
      title="本当に削除しますか？"
      trigger={<Button variant="destructive">削除</Button>}
    />
  );
}
```

## Subpath import

```tsx
import {
  ConfirmDialog,
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "@publira/ui-components/dialog";
```

## Props

ConfirmDialog の props は実装を参照してください。
