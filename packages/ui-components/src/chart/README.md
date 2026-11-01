# Chart

A small chart of one series of figures — a bar per day, a line, or a step per page — or of two series stacked into a bar per day, drawn as inline SVG beside the table that holds the same figures.

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

Two series of the same days stack into one bar per day, each in a tone of its own, with a legend that names them:

```tsx
<Chart.Root>
  <Chart.StackedBars
    aria-label="Net sales per day"
    series={[
      [1200, 0, 800],
      [980, 0, 0],
    ]}
  />
  <Chart.Legend>
    <Chart.LegendItem series={0}>Purchases</Chart.LegendItem>
    <Chart.LegendItem series={1}>Subscriptions</Chart.LegendItem>
  </Chart.Legend>
</Chart.Root>
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
| `Chart.StackedBars` | `<svg>` | `series`, two lists of figures for the same slots in the order they are stacked, and the same `<svg>` props |
| `Chart.Legend` | `<ul>` | those of a `<ul>` |
| `Chart.LegendItem` | `<li>` | `series`, `0` or `1`, whose tone its swatch shows, and those of an `<li>` |
| `Chart.Axis` | `<div>` | those of a `<div>`; its labels are spread from the left edge of the plot to the right |
| `Chart.AxisLabel` | `<span>` | those of a `<span>` |
| `Chart.Caption` | `<figcaption>` | those of a `<figcaption>` |

A plot with an `aria-label` is one image by that name; without one it is hidden from assistive technology, for a chart the caption or the table beside it already names. A plot is `h-40` across the whole width unless a `className` sizes it.

In a stack, the positive figures of a slot stand one on another from the baseline and its negative figures hang one under another below it, so the top of a bar is what its positive figures add up to. The first series is drawn in the primary colour and the second in a lighter shade of it, and a negative figure in the destructive colour in the same shade.
