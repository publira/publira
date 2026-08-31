# Button / LinkButton

The basic button components, implemented on top of [Base UI Button](https://base-ui.com/r/components/button).

## Usage

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

Follows the props of Base UI Button. See the [Base UI Button documentation](https://base-ui.com/r/components/button) for details.
