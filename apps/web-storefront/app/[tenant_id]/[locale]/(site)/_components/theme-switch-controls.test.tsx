// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StorefrontClientMessageKey } from "#lib/messages";
import { THEME_PREFERENCE_STORAGE_KEY } from "#lib/theme-preference";

import { DocumentTheme } from "../../_components/document-theme";
import * as ThemeSwitchControls from "./theme-switch-controls";

// The disclosure and its rows are slots of the navigation drawer, whose own
// behaviour `packages/layouts` covers; here they stand in as the elements they
// render, the panel always open.
vi.mock("@publira/layouts/site-layout", () => ({
  MobileNavigationDisclosure: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MobileNavigationDisclosurePanel: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <div>{children}</div>,
  MobileNavigationDisclosureTrigger: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <button type="button">{children}</button>,
}));

vi.mock("#components/client-message", () => ({
  ClientMessage: ({ message }: { message: StorefrontClientMessageKey }) =>
    bindMessages(sharedCatalog("en"), "en")(message),
  useClientMessages: () => bindMessages(sharedCatalog("en"), "en"),
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

const pressed = (name: string) =>
  screen.getByRole("button", { name }).getAttribute("aria-pressed");

describe("ThemeSwitch", () => {
  it("offers light, dark, and the system setting, marking the system for a reader who chose nothing", () => {
    render(<ThemeSwitchControls.Root />);

    const trigger = screen.getByRole("button", { name: "Theme" });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "Theme" })).toBeDefined();
    expect(pressed("Light")).toBe("false");
    expect(pressed("Dark")).toBe("false");
    expect(pressed("Match system")).toBe("true");

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("stores a choice and repaints the document in it", () => {
    render(
      <>
        <DocumentTheme />
        <ThemeSwitchControls.Root />
      </>
    );
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));

    fireEvent.click(screen.getByRole("button", { name: "Dark" }));

    expect(window.localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe(
      "dark"
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(pressed("Dark")).toBe("true");
    expect(pressed("Match system")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Match system" }));

    expect(window.localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe(
      "system"
    );
    expect(Object.hasOwn(document.documentElement.dataset, "theme")).toBe(
      false
    );
  });

  it("marks the choice a returning reader stored", () => {
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, "light");

    render(<ThemeSwitchControls.Root />);
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));

    expect(pressed("Light")).toBe("true");
  });
});

describe("ThemeSwitch.Disclosure", () => {
  it("offers the same choice as rows and stores the one chosen", () => {
    render(
      <>
        <DocumentTheme />
        <ThemeSwitchControls.Disclosure />
      </>
    );

    expect(screen.getByRole("button", { name: "Theme" })).toBeDefined();
    expect(pressed("Match system")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Light" }));

    expect(pressed("Light")).toBe("true");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
