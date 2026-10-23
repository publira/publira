# Popover

A compound primitive for the floating surfaces placed in a header and similar places. `Popover.Content` provides the portal, the positioning, and the shared surface styles, so the caller only defines the trigger, where it opens, and its content.

## Usage

```tsx
import * as Popover from "@publira/ui-components/popover";

export const LanguageSwitcher = () => (
  <Popover.Root>
    <Popover.Trigger aria-label="表示言語を選択">日本語</Popover.Trigger>
    <Popover.Content align="end" className="w-48" sideOffset={8}>
      <Popover.Title className="px-2.5 py-2 text-sm font-semibold">
        表示言語
      </Popover.Title>
      {/* The language options */}
    </Popover.Content>
  </Popover.Root>
);
```

## Subpath import

```tsx
import * as Popover from "@publira/ui-components/popover";
```

## Props

`Popover.Content` takes the Base UI Positioner props. Adjust the placement with `side`, `align`, `sideOffset`, and the like, and use `className` to set things such as the width of the surface. To adjust focus handling, pass Base UI Popup props through `popupProps`.
