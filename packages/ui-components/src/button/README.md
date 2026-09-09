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

## Variants

| `variant` | What it is for |
| --- | --- |
| `default` | The primary action of a console screen, filled in Ai |
| `secondary` | The reading action on the host site, filled in Shu |
| `ink` | A filled action that is neither of those |
| `outline` | A secondary action, on the control outline over the card fill |
| `ghost` | An action that carries no box until it is hovered |
| `link` | An action that reads as a link |
| `destructive` | A destructive action, outlined in crimson |
| `destructiveFilled` | The confirming button inside a `ConfirmDialog` |

`size` is `sm`, `md` (the default), `lg`, or `icon`.

## Props

Follows the props of Base UI Button. See the [Base UI Button documentation](https://base-ui.com/r/components/button) for details.
