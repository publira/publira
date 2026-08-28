// @vitest-environment jsdom

import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPlatformCurrentOperator } from "../lib/auth";
import { getPlatformLocale } from "../lib/locale";
import { PlatformUser } from "./platform-layout";

vi.mock("@publira/layouts/admin", () => ({
  ConsoleHeader: () => null,
  // The real menu lives in `@publira/layouts`; what this app owns is the copy
  // it hands over, so the stub only exposes the resolved aria-label.
  ConsoleHeaderUser: ({
    userMenuCopy,
  }: {
    userMenuCopy?: { accountMenuAriaLabel: string };
  }) => (
    <button aria-label={userMenuCopy?.accountMenuAriaLabel} type="button" />
  ),
  ConsoleHeaderUserSkeleton: () => null,
  ConsoleLayout: () => null,
  ConsoleLayoutContent: () => null,
  ConsoleLayoutMain: () => null,
  ConsoleSidebar: () => null,
}));

vi.mock("../lib/auth", () => ({
  getPlatformCurrentOperator: vi.fn(),
}));

vi.mock("../lib/auth-session", () => ({
  redirectToLoginIfSessionRejected: vi.fn(),
}));

vi.mock("../lib/locale", () => ({
  getPlatformLocale: vi.fn(() => Promise.resolve("ja")),
  loadPlatformMessages: (locale: Locale) =>
    Promise.resolve(sharedCatalog(locale)),
}));

vi.mock("../lib/logout-action", () => ({
  logoutAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

describe("PlatformUser", () => {
  it.each([
    ["ja", "青枝 花子のアカウントメニュー"],
    ["en", "Account menu for 青枝 花子"],
  ] as const)(
    "%s のアカウントメニューの aria-label に氏名を補間する",
    async (locale, expected) => {
      vi.mocked(getPlatformLocale).mockResolvedValue(locale);
      vi.mocked(getPlatformCurrentOperator).mockResolvedValue({
        ok: true,
        operator: {
          name: "青枝 花子",
          publicId: "operator_001",
          role: "super_admin",
        },
      });

      render(await PlatformUser());

      expect(screen.getByRole("button", { name: expected })).toBeDefined();
    }
  );
});
