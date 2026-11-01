/**
 * The coordinates a chart is drawn in. One slot per value across, and a fixed
 * height, both stretched to the box the chart is placed in: the plot takes
 * `preserveAspectRatio="none"`, so only the proportions here matter.
 */
export const SLOT_WIDTH = 10;
export const PLOT_HEIGHT = 100;

/** The share of a slot a bar leaves empty, split between its two sides. */
const BAR_GAP = 0.3;

export interface ChartScale {
  /** The width of the whole plot: one slot per value, and one slot at least. */
  width: number;
  /** The y of a value. */
  y: (value: number) => number;
  /** The y of zero, where a bar starts and the baseline is drawn. */
  baseline: number;
}

const sumOf = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0);

const scaleBetween = (
  low: number,
  highest: number,
  slots: number
): ChartScale => {
  const high = highest === low ? low + 1 : highest;

  const y = (value: number): number =>
    PLOT_HEIGHT - ((value - low) / (high - low)) * PLOT_HEIGHT;

  return {
    baseline: y(0),
    width: Math.max(slots, 1) * SLOT_WIDTH,
    y,
  };
};

/**
 * The scale of a set of values. Zero is always inside it, so a bar starts from
 * nothing and a fall to zero reaches the baseline, and a set with negative
 * values — a day on which more went back than sold — runs below it. A set
 * whose values are all the same is scaled as if the largest were one more, so
 * a run of zeros lies on the baseline instead of dividing by nothing.
 */
export const chartScale = (values: readonly number[]): ChartScale =>
  scaleBetween(Math.min(0, ...values), Math.max(0, ...values), values.length);

/**
 * The scale of a stack of series, one slot per figure of the first: what the
 * positive figures of a slot add up to stands above zero, and what its
 * negative ones add up to hangs below, so the scale runs from the deepest
 * slot to the tallest.
 */
export const stackedScale = (
  series: readonly (readonly number[])[]
): ChartScale => {
  const slots = series[0]?.length ?? 0;
  let low = 0;
  let high = 0;

  for (let index = 0; index < slots; index += 1) {
    const figures = series.map((values) => values[index] ?? 0);

    high = Math.max(high, sumOf(figures.filter((value) => value > 0)));
    low = Math.min(low, sumOf(figures.filter((value) => value < 0)));
  }

  return scaleBetween(low, high, slots);
};

export interface BarGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  negative: boolean;
}

/** One bar per value, each standing on the baseline or hanging from it. */
export const barGeometry = (values: readonly number[]): BarGeometry[] => {
  const scale = chartScale(values);
  const width = SLOT_WIDTH * (1 - BAR_GAP);

  return values.map((value, index) => {
    const top = scale.y(Math.max(value, 0));
    const bottom = scale.y(Math.min(value, 0));

    return {
      height: bottom - top,
      negative: value < 0,
      width,
      x: index * SLOT_WIDTH + (SLOT_WIDTH - width) / 2,
      y: top,
    };
  });
};

export interface StackedBarGeometry extends BarGeometry {
  /** The index of the series the segment is a figure of. */
  series: number;
}

/**
 * A segment per figure that is not zero, stacked in the order of the series:
 * each slot's positive figures stand one on another from the baseline up, and
 * its negative ones hang one under another from it, so the top of a slot is
 * what its positive figures add up to and the bottom what its negative ones do.
 */
export const stackedBarGeometry = (
  series: readonly (readonly number[])[]
): StackedBarGeometry[] => {
  const scale = stackedScale(series);
  const width = SLOT_WIDTH * (1 - BAR_GAP);
  const slots = series[0]?.length ?? 0;
  const segments: StackedBarGeometry[] = [];

  for (let index = 0; index < slots; index += 1) {
    let above = 0;
    let below = 0;

    for (const [seriesIndex, values] of series.entries()) {
      const value = values[index] ?? 0;

      if (value === 0) {
        continue;
      }

      const from = value > 0 ? above : below;
      const to = from + value;
      const top = scale.y(Math.max(from, to));

      segments.push({
        height: scale.y(Math.min(from, to)) - top,
        negative: value < 0,
        series: seriesIndex,
        width,
        x: index * SLOT_WIDTH + (SLOT_WIDTH - width) / 2,
        y: top,
      });

      if (value > 0) {
        above = to;
      } else {
        below = to;
      }
    }
  }

  return segments;
};

/**
 * The points of a line through the values, the first on the left edge and the
 * last on the right. A single value is a level line across the plot, since a
 * line needs two ends.
 */
export const linePoints = (values: readonly number[]): string => {
  const scale = chartScale(values);

  if (values.length === 0) {
    return "";
  }

  if (values.length === 1) {
    const y = scale.y(values[0] ?? 0);

    return `0,${y} ${scale.width},${y}`;
  }

  const step = scale.width / (values.length - 1);

  return values
    .map((value, index) => `${index * step},${scale.y(value)}`)
    .join(" ");
};

/**
 * The path of a step chart: each value is level across its own slot, and the
 * line drops or rises at the edge between two slots, so a reader sees where a
 * count changes rather than a slope between two pages that has no meaning.
 */
export const stepPath = (values: readonly number[]): string => {
  const scale = chartScale(values);

  return values
    .map((value, index) => {
      const y = scale.y(value);
      const right = (index + 1) * SLOT_WIDTH;

      return index === 0 ? `M0 ${y} H${right}` : `V${y} H${right}`;
    })
    .join(" ");
};
