// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlusIcon } from "./plus-icon";

describe("PlusIcon", () => {
  it("renders as an SVG with the given aria-label", () => {
    const { container } = render(<PlusIcon aria-label="Plus icon" />);

    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-label")).toBe("Plus icon");
  });

  it("reflects size, className, and strokeWidth", () => {
    const { container } = render(
      <PlusIcon className="test-icon" height={18} strokeWidth={3} width={18} />
    );

    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("class")?.includes("test-icon")).toBe(true);
    expect(svg?.getAttribute("width")).toBe("18");
    expect(svg?.getAttribute("height")).toBe("18");
    expect(svg?.getAttribute("stroke-width")).toBe("3");
  });
});
