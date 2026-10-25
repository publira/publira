# Chart

A small chart of one series of figures — a bar per day, a line, or a step per page — drawn as inline SVG beside the table that holds the same figures.

## Usage

```tsx
import * as Chart from "@publira/ui-components/chart";

export default function Example() {
  return (
    <Chart.Root>
      <Chart.Bars aria-label="Net sales per day" values={[1200, 0, 800]} />
      <Chart.Axis>
        <Chart.AxisLabel>Oct 1</Chart.AxisLabel>
        <Chart.AxisLabel>Oct 3</Chart.AxisLabel>
      </Chart.Axis>
      <Chart.Caption>Net sales per day</Chart.Caption>
    </Chart.Root>
  );
}
```

## Subpath import

```tsx
import * as Chart from "@publira/ui-components/chart";
```

## Props

| Part | Element | Props |
| --- | --- | --- |
| `Chart.Root` | `<figure>` | those of a `<figure>` |
| `Chart.Bars`, `Chart.Line`, `Chart.Steps` | `<svg>` | `values`, the figures from left to right, and the props of an `<svg>` apart from `viewBox`, `preserveAspectRatio`, `children`, and the SVG `values` attribute it replaces |
| `Chart.Axis` | `<div>` | those of a `<div>`; its labels are spread from the left edge of the plot to the right |
| `Chart.AxisLabel` | `<span>` | those of a `<span>` |
| `Chart.Caption` | `<figcaption>` | those of a `<figcaption>` |

A plot with an `aria-label` is one image by that name; without one it is hidden from assistive technology, for a chart the caption or the table beside it already names. A plot is `h-40` across the whole width unless a `className` sizes it.
