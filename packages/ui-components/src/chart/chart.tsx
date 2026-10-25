import { cn } from "@publira/utils";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import {
  barGeometry,
  chartScale,
  linePoints,
  PLOT_HEIGHT,
  stepPath,
} from "./chart-geometry";

type FigureProps = ComponentPropsWithoutRef<"figure">;
type DivProps = ComponentPropsWithoutRef<"div">;
type SpanProps = ComponentPropsWithoutRef<"span">;
type FigcaptionProps = ComponentPropsWithoutRef<"figcaption">;

export type ChartPlotProps = Omit<
  ComponentPropsWithoutRef<"svg">,
  "children" | "preserveAspectRatio" | "values" | "viewBox"
> & {
  /** The figures, in the order they are drawn from left to right. */
  values: readonly number[];
};

/**
 * A small chart of one series of figures, drawn as inline SVG rather than
 * through a chart library: a console screen shows the shape of a period next to
 * the table that holds its figures, and the table is what a reader reads the
 * numbers from. The chart has no axis ticks, gridlines, or tooltips for the
 * same reason.
 *
 * Composed rather than prop-driven, so the labels under the plot and the
 * caption are nodes the caller writes in its own locale.
 *
 * ```tsx
 * <Chart.Root>
 *   <Chart.Bars aria-label="Net sales per day" values={[1200, 0, 800]} />
 *   <Chart.Axis>
 *     <Chart.AxisLabel>Oct 1</Chart.AxisLabel>
 *     <Chart.AxisLabel>Oct 3</Chart.AxisLabel>
 *   </Chart.Axis>
 * </Chart.Root>
 * ```
 */
export const Chart = ({ className, ...props }: FigureProps) => (
  <figure {...props} className={cn("grid gap-2", className)} />
);

/**
 * The frame every plot shares. The geometry is drawn in units of its own and
 * stretched to the box, so a stroke is kept from stretching with it: without
 * `non-scaling-stroke` a line across a wide plot is drawn thicker than one
 * across a narrow plot.
 *
 * With an `aria-label` the plot is one image by that name, and without one it
 * is hidden, for a chart the caption or the table beside it already names.
 */
const ChartPlot = ({
  "aria-label": label,
  children,
  className,
  values,
  ...props
}: ChartPlotProps & { children: ReactNode }) => {
  const scale = chartScale(values);

  return (
    <svg
      {...props}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={cn("h-40 w-full overflow-visible", className)}
      preserveAspectRatio="none"
      role={label ? "img" : undefined}
      viewBox={`0 0 ${scale.width} ${PLOT_HEIGHT}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
      <line
        className="stroke-border"
        data-chart-baseline=""
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        x1={0}
        x2={scale.width}
        y1={scale.baseline}
        y2={scale.baseline}
      />
    </svg>
  );
};

/**
 * A bar per figure, such as the sales of each day of a period. A negative
 * figure hangs below the baseline in the destructive colour, so a day on which
 * more went back than sold reads as a loss rather than as a small sale.
 */
export const ChartBars = (props: ChartPlotProps) => (
  <ChartPlot {...props}>
    {barGeometry(props.values).map((bar) => (
      <rect
        className={bar.negative ? "fill-destructive" : "fill-primary"}
        // Each bar has a slot of its own, so its x names it.
        key={bar.x}
        height={bar.height}
        width={bar.width}
        x={bar.x}
        y={bar.y}
      />
    ))}
  </ChartPlot>
);

/** A line through the figures, such as the followers at the end of each day. */
export const ChartLine = (props: ChartPlotProps) => (
  <ChartPlot {...props}>
    <polyline
      className="fill-none stroke-primary"
      points={linePoints(props.values)}
      strokeLinejoin="round"
      strokeWidth={2}
      vectorEffect="non-scaling-stroke"
    />
  </ChartPlot>
);

/**
 * A level step per figure, such as the readers who reached each page of an
 * episode: the line falls at the edge between two steps, where the count
 * changes, instead of sloping across a stretch that has no figure of its own.
 */
export const ChartSteps = (props: ChartPlotProps) => (
  <ChartPlot {...props}>
    <path
      className="fill-none stroke-primary"
      d={stepPath(props.values)}
      strokeWidth={2}
      vectorEffect="non-scaling-stroke"
    />
  </ChartPlot>
);

/**
 * The labels under the plot, spread from its left edge to its right: the first
 * and last day of a period, or the first and last page of an episode.
 */
export const ChartAxis = ({ className, ...props }: DivProps) => (
  <div
    {...props}
    className={cn(
      "flex justify-between gap-4 text-xs text-muted-foreground tabular-nums",
      className
    )}
  />
);

export const ChartAxisLabel = (props: SpanProps) => <span {...props} />;

export const ChartCaption = ({ className, ...props }: FigcaptionProps) => (
  <figcaption
    {...props}
    className={cn("text-sm text-muted-foreground", className)}
  />
);
