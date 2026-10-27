// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SunMoonIcon } from "./sun-moon-icon";

describe("SunMoonIcon", () => {
  it("renders as an SVG with the given aria-label", () => {
    const { container } = render(
      <SunMoonIcon aria-label="Sun and moon icon" />
    );

    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-label")).toBe("Sun and moon icon");
  });

  it("reflects size, className, and strokeWidth", () => {
    const { container } = render(
      <SunMoonIcon
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
