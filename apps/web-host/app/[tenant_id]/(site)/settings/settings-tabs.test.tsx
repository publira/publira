// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsTabs } from "./settings-tabs";

const mockUsePathname = vi.hoisted(() => vi.fn(() => "/settings"));

vi.mock("next/navigation", () => ({
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
    render(<SettingsTabs />);

    expect(
      screen.getByRole("link", { name: "フォロー" }).getAttribute("href")
    ).toBe("/settings/follows");
  });

  it("フォロー一覧ではフォロータブだけを選択中にする", () => {
    mockUsePathname.mockReturnValue("/settings/follows");
    render(<SettingsTabs />);

    const follows = screen.getByRole("link", { name: "フォロー" });
    const basic = screen.getByRole("link", { name: "基本設定" });
    expect(follows.className).toContain("border-primary");
    expect(basic.className).toContain("border-transparent");
  });
});
