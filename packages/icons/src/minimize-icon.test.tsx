// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MinimizeIcon } from "./minimize-icon";

describe("MinimizeIcon", () => {
  it("renders as an SVG with the given aria-label", () => {
    const { container } = render(<MinimizeIcon aria-label="Minimize icon" />);

    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-label")).toBe("Minimize icon");
  });

  it("reflects size, className, and strokeWidth", () => {
    const { container } = render(
      <MinimizeIcon
        className="test-icon"
        height={18}
        strokeWidth={3}
        width={18}
      />
    );

    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("class")?.includes("test-icon")).toBe(true);
    expect(svg?.getAttribute("width")).toBe("18");
    expect(svg?.getAttribute("height")).toBe("18");
    expect(svg?.getAttribute("stroke-width")).toBe("3");
  });
});
