# Popover

A compound primitive for the floating surfaces placed in a header and similar places. `PopoverContent` provides the portal, the positioning, and the shared surface styles, so the caller only defines the trigger, where it opens, and its content.

## Usage

```tsx
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@publira/ui-components/popover";

export const LanguageSwitcher = () => (
  <Popover>
    <PopoverTrigger aria-label="表示言語を選択">日本語</PopoverTrigger>
    <PopoverContent align="end" className="w-48" sideOffset={8}>
      <PopoverTitle className="px-2.5 py-2 text-sm font-semibold">
        表示言語
      </PopoverTitle>
      {/* The language options */}
    </PopoverContent>
  </Popover>
);
```

## Subpath import

```tsx
import { Popover, PopoverContent } from "@publira/ui-components/popover";
```

## Props

`PopoverContent` takes the Base UI Positioner props. Adjust the placement with `side`, `align`, `sideOffset`, and the like, and use `className` to set things such as the width of the surface. To adjust focus handling, pass Base UI Popup props through `popupProps`.
