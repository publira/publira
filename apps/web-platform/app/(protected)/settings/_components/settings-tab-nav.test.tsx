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
  it("プラットフォーム設定のタブだけを並べる", () => {
    render(<SettingsTabNav current="general" />);

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(
      ["一般", "メール設定"]
    );
  });

  it("自分のアカウント設定はタブに混ぜない", () => {
    render(<SettingsTabNav current="general" />);

    expect(screen.queryByRole("link", { name: "アカウント" })).toBeNull();
    expect(
      screen
        .getAllByRole("link")
        .some((link) => link.getAttribute("href") === "/settings/account")
    ).toBe(false);
  });
});
