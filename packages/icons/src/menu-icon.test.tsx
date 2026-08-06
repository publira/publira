// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MenuIcon } from "./menu-icon";

describe("MenuIcon", () => {
  it("SVG として描画される", () => {
    const { container } = render(<MenuIcon aria-label="Menu icon" />);

    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-label")).toBe("Menu icon");
  });

  it("size/className/strokeWidth を反映する", () => {
    const { container } = render(
      <MenuIcon className="test-icon" height={18} strokeWidth={3} width={18} />
    );

    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("class")?.includes("test-icon")).toBe(true);
    expect(svg?.getAttribute("width")).toBe("18");
    expect(svg?.getAttribute("height")).toBe("18");
    expect(svg?.getAttribute("stroke-width")).toBe("3");
  });
});
