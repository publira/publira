// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import * as Card from ".";

afterEach(cleanup);

describe("Card", () => {
  // An in-flow surface is separated from the page by the step to `card` and by
  // a hairline. A shadow belongs to a layer that floats above the page.
  it("is a hairline and a fill, with no radius and no shadow", () => {
    render(<Card.Root data-testid="card" />);

    const classes = [...screen.getByTestId("card").classList];
    expect(classes).toContain("border-border");
    expect(classes).toContain("bg-card");
    expect(classes.some((name) => name.startsWith("rounded-"))).toBe(false);
    expect(classes.some((name) => name.startsWith("shadow-"))).toBe(false);
  });

  it("sets its title at the section heading step, in the sans face", () => {
    render(<Card.Title>Recent episodes</Card.Title>);

    const classes = [...screen.getByText("Recent episodes").classList];
    expect(classes).toContain("text-xl");
    expect(classes).toContain("font-sans");
  });
});
