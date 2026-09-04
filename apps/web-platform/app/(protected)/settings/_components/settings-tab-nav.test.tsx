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
  it("lists only platform settings tabs", () => {
    render(
      <SettingsTabNav
        current="general"
        emailLabel="Email"
        generalLabel="General"
      />
    );

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(
      ["General", "Email"]
    );
  });

  it("does not include personal account settings tabs", () => {
    render(
      <SettingsTabNav
        current="general"
        emailLabel="Email"
        generalLabel="General"
      />
    );

    expect(screen.queryByRole("link", { name: "Account" })).toBeNull();
    expect(
      screen
        .getAllByRole("link")
        .some((link) => link.getAttribute("href") === "/settings/account")
    ).toBe(false);
  });
});
