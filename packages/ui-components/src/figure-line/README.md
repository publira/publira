# FigureLine

The figures a screen opens with, as one line of label-and-figure pairs separated by hairlines.

A console dashboard is read for what it lists, so its totals are a line of type above the list rather than a row of tiles. The line turns vertical below `sm`, and the hairlines turn with it.

## Usage

```tsx
import * as FigureLine from "@publira/ui-components/figure-line";

export default function Example() {
  return (
    <FigureLine.Root>
      <FigureLine.Figure>
        <FigureLine.Label>Published series</FigureLine.Label>
        <FigureLine.Value>12</FigureLine.Value>
      </FigureLine.Figure>
      <FigureLine.Figure>
        <FigureLine.Label>Draft episodes</FigureLine.Label>
        <FigureLine.Value>4</FigureLine.Value>
      </FigureLine.Figure>
    </FigureLine.Root>
  );
}
```

## Subpath import

```tsx
import * as FigureLine from "@publira/ui-components/figure-line";
```

## Props

`FigureLine.Root` takes the props of a `<dl>` and `FigureLine.Figure` those of a `<div>`; the label and the value are the `<dt>` and the `<dd>` of the pair.
