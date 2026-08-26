// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsTabNav } from "./settings-tab-nav";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("SettingsTabNav", () => {
  it("テナント設定のタブだけを並べる", () => {
    render(<SettingsTabNav current="basic" />);

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(
      ["基本情報", "テーマ", "メール情報", "決済"]
    );
  });

  it("自分のアカウント設定はタブに混ぜない", () => {
    render(<SettingsTabNav current="basic" />);

    expect(screen.queryByRole("link", { name: "アカウント" })).toBeNull();
    expect(
      screen
        .getAllByRole("link")
        .some((link) => link.getAttribute("href") === "/settings/account")
    ).toBe(false);
  });
});
