// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UserIcon } from "./user-icon";

describe("UserIcon", () => {
  it("SVG として描画される", () => {
    const { container } = render(<UserIcon aria-label="User icon" />);

    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-label")).toBe("User icon");
  });

  it("size/className/strokeWidth を反映する", () => {
    const { container } = render(
      <UserIcon className="test-icon" height={18} strokeWidth={3} width={18} />
    );

    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("class")?.includes("test-icon")).toBe(true);
    expect(svg?.getAttribute("width")).toBe("18");
    expect(svg?.getAttribute("height")).toBe("18");
    expect(svg?.getAttribute("stroke-width")).toBe("3");
  });
});
