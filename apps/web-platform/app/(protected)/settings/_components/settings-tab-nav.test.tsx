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
        communityLabel="Community"
        current="general"
        emailLabel="Email"
        generalLabel="General"
        retentionLabel="Retention"
        securityLabel="Security"
        storageLabel="Storage"
        webPushLabel="Web Push"
      />
    );

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(
      [
        "General",
        "Email",
        "Storage",
        "Web Push",
        "Security",
        "Community",
        "Retention",
      ]
    );
  });

  it("does not include personal account settings tabs", () => {
    render(
      <SettingsTabNav
        communityLabel="Community"
        current="general"
        emailLabel="Email"
        generalLabel="General"
        retentionLabel="Retention"
        securityLabel="Security"
        storageLabel="Storage"
        webPushLabel="Web Push"
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
