// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChevronUpIcon } from "./chevron-up-icon";

describe("ChevronUpIcon", () => {
  it("renders as an SVG with the given aria-label", () => {
    const { container } = render(
      <ChevronUpIcon aria-label="Chevron up icon" />
    );

    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-label")).toBe("Chevron up icon");
  });

  it("reflects size, className, and strokeWidth", () => {
    const { container } = render(
      <ChevronUpIcon
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
