// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getAuthActions } from "./auth-actions";
import {
  SiteLayout,
  SiteLayoutBrandLink,
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
  it("SiteLayoutNav は渡されたナビを next/link で表示する", () => {
    render(
      <SiteLayoutNav
        items={[
          { href: "/authors", label: "著者" },
          { href: "/series", label: "シリーズ" },
        ]}
      />
    );

    const authors = screen.getByRole("link", { name: "著者" });
    expect(authors.getAttribute("href")).toBe("/authors");
    expect(authors.dataset.nextLink).toBe("true");

    const series = screen.getByRole("link", { name: "シリーズ" });
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

describe("SiteLayoutBrandLink", () => {
  it("brandMark がなければテキストブランドを next/link で出す", () => {
    render(<SiteLayoutBrandLink href="/" label="青枝出版" />);

    const brand = screen.getByRole("link", { name: "青枝出版" });
    expect(brand.getAttribute("href")).toBe("/");
    expect(brand.dataset.nextLink).toBe("true");
  });

  it("brandMark があればテキストブランドの代わりに載せる", () => {
    render(
      <SiteLayoutBrandLink
        brandMark={<span>テナントロゴ</span>}
        href="/"
        label="青枝出版"
      />
    );

    expect(screen.getByText("テナントロゴ")).toBeDefined();
    expect(screen.queryByText("青枝出版")).toBeNull();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/");
  });

  it("brandMark が undefined ならテキストブランドにフォールバックする", () => {
    render(
      <SiteLayoutBrandLink brandMark={undefined} href="/" label="青枝出版" />
    );

    expect(screen.getByRole("link", { name: "青枝出版" })).toBeDefined();
  });

  it("label も brandMark もなければ何も出さない", () => {
    const { container } = render(<SiteLayoutBrandLink href="/" />);

    expect(container.querySelector("a")).toBeNull();
  });
});

describe("SiteLayoutActions", () => {
  it("通常のアクションは next/link で描画する", () => {
    render(
      <SiteLayoutActions
        logoutLabel="ログアウト"
        primaryAction={{ href: "/signup", label: "はじめる" }}
        secondaryAction={{ href: "/login", label: "ログイン" }}
      />
    );

    const start = screen.getByRole("link", { name: "はじめる" });
    expect(start.getAttribute("href")).toBe("/signup");
    expect(start.dataset.nextLink).toBe("true");

    const signIn = screen.getByRole("link", { name: "ログイン" });
    expect(signIn.getAttribute("href")).toBe("/login");
    expect(signIn.dataset.nextLink).toBe("true");
  });

  it("logoutAction があるときは form + submit ボタンで描画する", () => {
    const logoutAction = vi.fn();
    render(
      <SiteLayoutActions
        logoutAction={logoutAction}
        logoutLabel="ログアウト"
        primaryAction={{ href: "/my", label: "マイページ" }}
      />
    );

    const logout = screen.getByRole("button", { name: "ログアウト" });
    expect(logout.getAttribute("type")).toBe("submit");
    expect(logout.closest("form")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "ログアウト" })).toBeNull();

    expect(
      screen.getByRole("link", { name: "マイページ" }).dataset.nextLink
    ).toBe("true");
  });
});

describe("getAuthActions", () => {
  const labels = {
    login: "ログイン",
    myPage: "マイページ",
    signup: "はじめる",
  };

  it("未ログインでは渡されたログイン / 登録ラベルのリンクを返す", () => {
    expect(getAuthActions(false, labels)).toEqual({
      primaryAction: { href: "/signup", label: "はじめる" },
      secondaryAction: { href: "/login", label: "ログイン" },
    });
  });

  it("ログイン済みではマイページのみ返し、ログアウトはリンクにしない", () => {
    expect(getAuthActions(true, labels)).toEqual({
      primaryAction: { href: "/my", label: "マイページ" },
    });
  });
});
