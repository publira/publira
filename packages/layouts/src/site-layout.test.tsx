// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SiteLayout,
  SiteLayoutBrandSkeleton,
  SiteLayoutFooterSkeleton,
  SiteLayoutHeader,
  SiteLayoutHeaderActionsSkeleton,
  SiteLayoutMain,
  SiteLayoutNav,
} from "./site-layout";

vi.mock("@publira/ui-components/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div className={className} data-testid="skeleton" />
  ),
}));

afterEach(() => {
  cleanup();
});

describe("SiteLayout components", () => {
  it("SiteLayoutNav はデフォルトナビを表示する", () => {
    render(<SiteLayoutNav />);

    expect(
      screen.getByRole("link", { name: "Authors" }).getAttribute("href")
    ).toBe("/authors");
    expect(
      screen.getByRole("link", { name: "Series" }).getAttribute("href")
    ).toBe("/series");
  });

  it("SiteLayout + Header + Main を構成表示できる", () => {
    render(
      <SiteLayout>
        <SiteLayoutHeader>
          <p>ヘッダー</p>
        </SiteLayoutHeader>
        <SiteLayoutMain>
          <p>本文</p>
        </SiteLayoutMain>
      </SiteLayout>
    );

    expect(screen.getByText("ヘッダー")).toBeTruthy();
    expect(screen.getByText("本文")).toBeTruthy();
  });

  it("各 skeleton コンポーネントを表示できる", () => {
    render(
      <>
        <SiteLayoutBrandSkeleton />
        <SiteLayoutHeaderActionsSkeleton />
        <SiteLayoutFooterSkeleton />
      </>
    );

    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });
});
