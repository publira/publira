// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlugIcon } from "./plug-icon";

describe("PlugIcon", () => {
  it("renders as an SVG with the given aria-label", () => {
    const { container } = render(<PlugIcon aria-label="Plug icon" />);

    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-label")).toBe("Plug icon");
  });

  it("reflects size, className, and strokeWidth", () => {
    const { container } = render(
      <PlugIcon className="test-icon" height={18} strokeWidth={3} width={18} />
    );

    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("class")?.includes("test-icon")).toBe(true);
    expect(svg?.getAttribute("width")).toBe("18");
    expect(svg?.getAttribute("height")).toBe("18");
    expect(svg?.getAttribute("stroke-width")).toBe("3");
  });
});
