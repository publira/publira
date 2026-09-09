// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EmptyState } from "./empty-state";

afterEach(cleanup);

describe("EmptyState", () => {
  // The rule above the text is the one that separates the rows of a list that
  // does have something in it, so an empty section keeps the page's structure.
  it("is a hairline above centred text, not a dashed box", () => {
    render(<EmptyState data-testid="empty" />);

    const classes = [...screen.getByTestId("empty").classList];
    expect(classes).toContain("border-t");
    expect(classes).toContain("text-center");
    expect(classes).not.toContain("border-dashed");
    expect(classes.some((name) => name.startsWith("rounded-"))).toBe(false);
  });
});
