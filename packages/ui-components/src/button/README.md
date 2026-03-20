# Button / LinkButton

基本的なボタンコンポーネント群です。[Base UI Button](https://base-ui.com/r/components/button) をベースに実装しています。

## 使用方法

### Button

```tsx
import { Button } from "@publira/ui-components/button";

export default function Example() {
  return <Button>Click me</Button>;
}
```

### LinkButton

```tsx
import { LinkButton } from "@publira/ui-components/button";

export default function Example() {
  return <LinkButton href="/path">Go to page</LinkButton>;
}
```

## Subpath import

```tsx
import { Button, LinkButton } from "@publira/ui-components/button";
```

## Props

Base UI Button のプロップに準じます。詳細は [Base UI Button documentation](https://base-ui.com/r/components/button) を参照してください。
