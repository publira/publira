// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ExternalLinkIcon } from "./external-link-icon";

describe("ExternalLinkIcon", () => {
  it("renders as an SVG with the given aria-label", () => {
    const { container } = render(
      <ExternalLinkIcon aria-label="External link icon" />
    );

    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-label")).toBe("External link icon");
  });

  it("reflects size, className, and strokeWidth", () => {
    const { container } = render(
      <ExternalLinkIcon
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
