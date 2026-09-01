// @vitest-environment jsdom

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsTabNav } from "./settings-tab-nav";

vi.mock("#components/message", () => ({
  Message: ({ message }: { message: string }) =>
    getMessage(sharedCatalog("ja"), message),
}));

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
  it("lists only the tenant settings tabs", () => {
    render(<SettingsTabNav current="basic" />);

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(
      ["基本情報", "テーマ", "メール情報", "決済"]
    );
  });

  it("keeps the personal account settings out of the tabs", () => {
    render(<SettingsTabNav current="basic" />);

    expect(screen.queryByRole("link", { name: "アカウント" })).toBeNull();
    expect(
      screen
        .getAllByRole("link")
        .some((link) => link.getAttribute("href") === "/settings/account")
    ).toBe(false);
  });
});
