// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Figure, FigureLabel, FigureLine, FigureValue } from "./figure-line";

afterEach(cleanup);

const renderLine = () =>
  render(
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

describe("FigureLine", () => {
  it("pairs each label with its figure as a description list", () => {
    renderLine();

    expect(screen.getByText("Published series").tagName).toBe("DT");
    expect(screen.getByText("12").tagName).toBe("DD");
  });

  // The figures are a line of type, not a row of tiles.
  it("separates the pairs with hairlines and no surface of their own", () => {
    const { container } = renderLine();

    const line = container.querySelector("dl");
    const classes = [...(line?.classList ?? [])];
    expect(classes).toContain("divide-border");
    expect(classes).toContain("border-border");
    expect(classes.some((name) => name.startsWith("bg-"))).toBe(false);
    expect(classes.some((name) => name.startsWith("shadow-"))).toBe(false);
  });

  it("sets the figures in tabular numerals so a line of them lines up", () => {
    renderLine();

    expect([...screen.getByText("12").classList]).toContain("tabular-nums");
  });
});
