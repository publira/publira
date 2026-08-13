// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getAuthActions } from "./auth-actions";
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

  it("logoutAction があるときは form + submit ボタンで描画する", () => {
    const logoutAction = vi.fn();
    render(
      <SiteLayoutActions
        logoutAction={logoutAction}
        primaryAction={{ href: "/my", label: "My Page" }}
      />
    );

    const logout = screen.getByRole("button", { name: "Logout" });
    expect(logout.getAttribute("type")).toBe("submit");
    expect(logout.closest("form")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Logout" })).toBeNull();

    expect(screen.getByRole("link", { name: "My Page" }).dataset.nextLink).toBe(
      "true"
    );
  });
});

describe("getAuthActions", () => {
  it("未ログインでは Sign in / Start のリンクを返す", () => {
    expect(getAuthActions(false)).toEqual({
      primaryAction: { href: "/signup", label: "Start" },
      secondaryAction: { href: "/login", label: "Sign in" },
    });
  });

  it("ログイン済みでは My Page のみ返し、ログアウトはリンクにしない", () => {
    expect(getAuthActions(true)).toEqual({
      primaryAction: { href: "/my", label: "My Page" },
    });
  });
});
