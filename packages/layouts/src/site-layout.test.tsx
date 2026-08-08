// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
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
import { SiteLayoutActions } from "./site-layout-actions";

vi.mock("@publira/ui-components/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div className={className} data-testid="skeleton" />
  ),
}));

// next/link かどうかを DOM から判別できるようにする
vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props} data-next-link="true">
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("SiteLayout components", () => {
  it("SiteLayoutNav はデフォルトナビを next/link で表示する", () => {
    render(<SiteLayoutNav />);

    const authors = screen.getByRole("link", { name: "Authors" });
    expect(authors.getAttribute("href")).toBe("/authors");
    expect(authors.dataset.nextLink).toBe("true");

    const series = screen.getByRole("link", { name: "Series" });
    expect(series.getAttribute("href")).toBe("/series");
    expect(series.dataset.nextLink).toBe("true");
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

describe("SiteLayoutActions", () => {
  it("通常のアクションは next/link で描画する", () => {
    render(
      <SiteLayoutActions
        primaryAction={{ href: "/signup", label: "Start" }}
        secondaryAction={{ href: "/login", label: "Sign in" }}
      />
    );

    const start = screen.getByRole("link", { name: "Start" });
    expect(start.getAttribute("href")).toBe("/signup");
    expect(start.dataset.nextLink).toBe("true");

    const signIn = screen.getByRole("link", { name: "Sign in" });
    expect(signIn.getAttribute("href")).toBe("/login");
    expect(signIn.dataset.nextLink).toBe("true");
  });

  it("hardNavigation のアクションは prefetch されない素の <a> にする", () => {
    render(
      <SiteLayoutActions
        primaryAction={{ href: "/my", label: "My Page" }}
        secondaryAction={{
          hardNavigation: true,
          href: "/logout",
          label: "Logout",
        }}
      />
    );

    const logout = screen.getByRole("link", { name: "Logout" });
    expect(logout.getAttribute("href")).toBe("/logout");
    expect(logout.dataset.nextLink).toBeUndefined();

    // 同じ描画の中でも hardNavigation でない方は next/link のまま
    expect(screen.getByRole("link", { name: "My Page" }).dataset.nextLink).toBe(
      "true"
    );
  });
});
