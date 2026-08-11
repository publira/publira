// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Skeleton, SkeletonCard, SkeletonLine, SkeletonText } from "./skeleton";

describe("Skeleton components", () => {
  it("Skeleton は aria-hidden 属性を持つ", () => {
    render(<Skeleton data-testid="sk" />);

    const el = screen.getByTestId("sk");
    expect(el.getAttribute("aria-hidden")).toBe("true");
  });

  it("SkeletonLine は行内に置ける span として描画される", () => {
    const { container } = render(<SkeletonLine className="h-7 w-64" />);

    const el = container.firstElementChild;
    expect(el?.tagName).toBe("SPAN");
    expect(el?.getAttribute("aria-hidden")).toBe("true");
    expect(el?.classList.contains("inline-block")).toBe(true);
    expect(el?.classList.contains("align-middle")).toBe(true);
    expect(el?.classList.contains("h-7")).toBe(true);
  });

  it("SkeletonLine のアニメーションは prefers-reduced-motion を尊重する", () => {
    const { container } = render(<SkeletonLine />);

    const el = container.firstElementChild;
    expect(el?.classList.contains("motion-safe:animate-pulse")).toBe(true);
    // 素の animate-pulse だと reduced motion でも動いてしまう
    expect(el?.classList.contains("animate-pulse")).toBe(false);
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
