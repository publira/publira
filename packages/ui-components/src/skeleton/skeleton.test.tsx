// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Skeleton, SkeletonCard, SkeletonText } from "./skeleton";

describe("Skeleton components", () => {
  it("Skeleton は aria-hidden 属性を持つ", () => {
    render(<Skeleton data-testid="sk" />);

    const el = screen.getByTestId("sk");
    expect(el.getAttribute("aria-hidden")).toBe("true");
  });

  it("SkeletonText は lines 数に応じて要素を描画する", () => {
    const { container } = render(<SkeletonText lines={4} />);

    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(4);
  });

  it("SkeletonCard は複数の Skeleton 要素を含む", () => {
    const { container } = render(<SkeletonCard />);

    expect(
      container.querySelectorAll('[aria-hidden="true"]').length
    ).toBeGreaterThan(0);
  });
});
