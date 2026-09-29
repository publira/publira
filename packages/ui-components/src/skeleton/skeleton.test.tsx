// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Skeleton, SkeletonCard, SkeletonLine, SkeletonText } from "./skeleton";

describe("Skeleton components", () => {
  it("Skeleton carries the aria-hidden attribute", () => {
    render(<Skeleton data-testid="sk" />);

    const el = screen.getByTestId("sk");
    expect(el.getAttribute("aria-hidden")).toBe("true");
  });

  it("SkeletonLine renders as a span that fits inside a line", () => {
    const { container } = render(<SkeletonLine className="h-7 w-64" />);

    const el = container.firstElementChild;
    expect(el?.tagName).toBe("SPAN");
    expect(el?.getAttribute("aria-hidden")).toBe("true");
    expect(el?.classList.contains("inline-block")).toBe(true);
    expect(el?.classList.contains("align-middle")).toBe(true);
    expect(el?.classList.contains("h-7")).toBe(true);
  });

  it("SkeletonLine's animation respects prefers-reduced-motion", () => {
    const { container } = render(<SkeletonLine />);

    const el = container.firstElementChild;
    expect(el?.classList.contains("motion-safe:animate-pulse")).toBe(true);
    // A bare animate-pulse would keep moving under reduced motion.
    expect(el?.classList.contains("animate-pulse")).toBe(false);
  });

  it("SkeletonText renders one element per line count", () => {
    const { container } = render(<SkeletonText lines={4} />);

    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(4);
  });

  it("SkeletonCard holds several Skeleton elements", () => {
    const { container } = render(<SkeletonCard />);

    expect(
      container.querySelectorAll('[aria-hidden="true"]').length
    ).toBeGreaterThan(0);
  });
});
