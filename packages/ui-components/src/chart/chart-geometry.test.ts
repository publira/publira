import { describe, expect, it } from "vitest";

import {
  barGeometry,
  chartScale,
  linePoints,
  PLOT_HEIGHT,
  SLOT_WIDTH,
  stackedBarGeometry,
  stackedScale,
  stepPath,
} from "./chart-geometry";

describe("chartScale", () => {
  it("puts zero at the bottom and the largest figure at the top", () => {
    const scale = chartScale([2, 4]);

    expect(scale.baseline).toBe(PLOT_HEIGHT);
    expect(scale.y(4)).toBe(0);
    expect(scale.y(2)).toBe(PLOT_HEIGHT / 2);
  });

  it("lifts the baseline off the bottom when a figure is negative", () => {
    const scale = chartScale([-1, 3]);

    expect(scale.baseline).toBe(75);
    expect(scale.y(-1)).toBe(PLOT_HEIGHT);
  });

  it("lays a run of zeros on the baseline instead of dividing by nothing", () => {
    const scale = chartScale([0, 0, 0]);

    expect(scale.y(0)).toBe(PLOT_HEIGHT);
    expect(Number.isFinite(scale.y(0))).toBe(true);
  });

  it("gives every figure a slot, and an empty chart one slot", () => {
    expect(chartScale([1, 2, 3]).width).toBe(3 * SLOT_WIDTH);
    expect(chartScale([]).width).toBe(SLOT_WIDTH);
  });
});

describe("barGeometry", () => {
  it("stands a positive bar on the baseline at the height of its figure", () => {
    const [low, high] = barGeometry([1, 4]);

    expect(high?.y).toBe(0);
    expect(high?.height).toBe(PLOT_HEIGHT);
    expect(low?.height).toBe(PLOT_HEIGHT / 4);
    expect((low?.y ?? 0) + (low?.height ?? 0)).toBe(PLOT_HEIGHT);
  });

  it("hangs a negative bar from the baseline and marks it", () => {
    const [loss, sale] = barGeometry([-1, 3]);

    expect(loss).toMatchObject({ height: 25, negative: true, y: 75 });
    expect(sale).toMatchObject({ negative: false, y: 0 });
  });

  it("centres each bar in a slot of its own", () => {
    const [first, second] = barGeometry([1, 1]);

    expect((first?.x ?? 0) + (first?.width ?? 0) / 2).toBe(SLOT_WIDTH / 2);
    expect((second?.x ?? 0) - (first?.x ?? 0)).toBe(SLOT_WIDTH);
  });
});

describe("linePoints", () => {
  it("runs from the left edge to the right edge", () => {
    expect(linePoints([0, 5, 10])).toBe("0,100 15,50 30,0");
  });

  it("draws a single figure as a level line across the plot", () => {
    expect(linePoints([3])).toBe(`0,0 ${SLOT_WIDTH},0`);
  });

  it("draws nothing for no figures", () => {
    expect(linePoints([])).toBe("");
  });
});

describe("stepPath", () => {
  it("keeps each figure level across its slot and changes at the edges", () => {
    expect(stepPath([4, 2, 2, 0])).toBe("M0 0 H10 V50 H20 V50 H30 V100 H40");
  });
});

describe("stackedScale", () => {
  it("runs from the deepest slot's losses to the tallest slot's sum", () => {
    const scale = stackedScale([
      [2, -1],
      [1, -2],
    ]);

    expect(scale.y(3)).toBe(0);
    expect(scale.y(-3)).toBe(PLOT_HEIGHT);
    expect(scale.baseline).toBe(PLOT_HEIGHT / 2);
    expect(scale.width).toBe(2 * SLOT_WIDTH);
  });
});

describe("stackedBarGeometry", () => {
  it("stands the second series on the first, and leaves out a zero", () => {
    const [first, second, alone] = stackedBarGeometry([
      [1, 0],
      [3, 2],
    ]);

    expect(first).toMatchObject({ height: 25, series: 0, y: 75 });
    expect(second).toMatchObject({ height: 75, series: 1, y: 0 });
    expect(alone).toMatchObject({ height: 50, series: 1, y: 50 });
    expect(alone?.x).toBe((first?.x ?? 0) + SLOT_WIDTH);
  });

  it("hangs a slot's negative figures from the baseline, one under another", () => {
    const [sale, firstLoss, secondLoss] = stackedBarGeometry([
      [2, -1],
      [0, -1],
    ]);

    expect(sale).toMatchObject({ height: 50, negative: false, y: 0 });
    expect(firstLoss).toMatchObject({ height: 25, negative: true, y: 50 });
    expect(secondLoss).toMatchObject({
      height: 25,
      negative: true,
      series: 1,
      y: 75,
    });
  });
});
