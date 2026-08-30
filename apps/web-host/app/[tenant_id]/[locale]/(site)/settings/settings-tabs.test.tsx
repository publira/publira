// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsTabs } from "./settings-tabs";

const labels = {
  basic: "基本設定",
  follows: "フォロー",
  notifications: "通知",
  security: "セキュリティ",
};

const mockUsePathname = vi.hoisted(() => vi.fn(() => "/settings"));

vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: "ja" }),
  usePathname: () => mockUsePathname(),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  } & ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("SettingsTabs", () => {
  it("フォロー一覧へのナビを出す", () => {
    mockUsePathname.mockReturnValue("/settings");
    render(<SettingsTabs labels={labels} />);

    expect(
      screen.getByRole("link", { name: "フォロー" }).getAttribute("href")
    ).toBe("/settings/follows");
  });

  it("フォロー一覧ではフォロータブだけを選択中にする", () => {
    mockUsePathname.mockReturnValue("/settings/follows");
    render(<SettingsTabs labels={labels} />);

    const follows = screen.getByRole("link", { name: "フォロー" });
    const basic = screen.getByRole("link", { name: "基本設定" });
    expect(follows.className).toContain("border-primary");
    expect(basic.className).toContain("border-transparent");
  });

  // A prerendered shell reports the rewritten pathname, so the selected tab
  // must not depend on which of the two shapes `usePathname()` returns.
  it("rewrite 後のパスでも選択中のタブは変わらない", () => {
    mockUsePathname.mockReturnValue(
      "/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/ja/settings/follows"
    );
    render(<SettingsTabs labels={labels} />);

    const follows = screen.getByRole("link", { name: "フォロー" });
    const basic = screen.getByRole("link", { name: "基本設定" });
    expect(follows.className).toContain("border-primary");
    expect(basic.className).toContain("border-transparent");
  });
});
