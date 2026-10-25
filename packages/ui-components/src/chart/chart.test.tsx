// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import * as Chart from ".";

afterEach(cleanup);

describe("Chart", () => {
  it("is one image by the name it is given", () => {
    render(
      <Chart.Root>
        <Chart.Bars aria-label="Net sales per day" values={[1, 2]} />
      </Chart.Root>
    );

    expect(screen.getByRole("img", { name: "Net sales per day" }).tagName).toBe(
      "svg"
    );
  });

  it("is hidden when it has no name, for a chart its caption names", () => {
    const { container } = render(
      <Chart.Root>
        <Chart.Line values={[1, 2]} />
        <Chart.Caption>Followers</Chart.Caption>
      </Chart.Root>
    );

    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true"
    );
    expect(screen.getByText("Followers").tagName).toBe("FIGCAPTION");
  });

  it("draws a bar per figure, a loss in the destructive colour", () => {
    const { container } = render(<Chart.Bars values={[3, -1, 0]} />);

    const bars = [...container.querySelectorAll("rect")];
    expect(bars).toHaveLength(3);
    expect(bars[0]?.getAttribute("class")).toBe("fill-primary");
    expect(bars[1]?.getAttribute("class")).toBe("fill-destructive");
  });

  it("stretches the plot to its box without thickening the strokes", () => {
    const { container } = render(<Chart.Steps values={[3, 2, 1]} />);

    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("preserveAspectRatio")).toBe("none");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 30 100");
    expect(container.querySelector("path")?.getAttribute("vector-effect")).toBe(
      "non-scaling-stroke"
    );
  });

  it("draws the baseline at zero", () => {
    const { container } = render(<Chart.Line values={[-1, 3]} />);

    expect(
      container.querySelector("[data-chart-baseline]")?.getAttribute("y1")
    ).toBe("75");
  });

  it("spreads the labels under the plot from edge to edge", () => {
    render(
      <Chart.Axis>
        <Chart.AxisLabel>Oct 1</Chart.AxisLabel>
        <Chart.AxisLabel>Oct 28</Chart.AxisLabel>
      </Chart.Axis>
    );

    expect(screen.getByText("Oct 1").parentElement?.className).toContain(
      "justify-between"
    );
  });
});
