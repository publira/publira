# FigureLine

The figures a screen opens with, as one line of label-and-figure pairs separated by hairlines.

A console dashboard is read for what it lists, so its totals are a line of type above the list rather than a row of tiles. The line turns vertical below `sm`, and the hairlines turn with it.

## Usage

```tsx
import {
  Figure,
  FigureLabel,
  FigureLine,
  FigureValue,
} from "@publira/ui-components";

export default function Example() {
  return (
    <FigureLine>
      <Figure>
        <FigureLabel>Published series</FigureLabel>
        <FigureValue>12</FigureValue>
      </Figure>
      <Figure>
        <FigureLabel>Draft episodes</FigureLabel>
        <FigureValue>4</FigureValue>
      </Figure>
    </FigureLine>
  );
}
```

## Subpath import

```tsx
import { FigureLine } from "@publira/ui-components/figure-line";
```

## Props

`FigureLine` takes the props of a `<dl>` and `Figure` those of a `<div>`; the label and the value are the `<dt>` and the `<dd>` of the pair.
