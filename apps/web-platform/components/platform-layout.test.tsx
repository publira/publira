// @vitest-environment jsdom

import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPlatformCurrentOperator } from "../lib/auth";
import { getPlatformLocale } from "../lib/locale";
import {
  countUnreadNotifications,
  listNotifications,
} from "../lib/notification";
import { PlatformLocaleSwitcher } from "./locale-switcher";
import { PlatformNotificationBell, PlatformUser } from "./platform-layout";

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

vi.mock("../lib/notification", () => ({
  countUnreadNotifications: vi.fn(),
  listNotifications: vi.fn(),
}));

vi.mock("./message", () => ({
  Message: ({ message }: { message: string }) => message,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
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

describe("PlatformLocaleSwitcher", () => {
  it.each([
    ["ja", "表示言語: 日本語"],
    ["en", "Display language: English"],
  ] as const)(
    "%s の現在の表示言語をヘッダートリガーに示す",
    async (locale, expected) => {
      vi.mocked(getPlatformLocale).mockResolvedValue(locale);

      render(await PlatformLocaleSwitcher());

      expect(screen.getByRole("button", { name: expected })).toBeDefined();
    }
  );
});

describe("PlatformNotificationBell", () => {
  it("shows the five most recent notifications in the menu and links to the notification list", async () => {
    vi.mocked(getPlatformLocale).mockResolvedValue("ja");
    vi.mocked(countUnreadNotifications).mockResolvedValue({
      ok: true,
      unreadCount: 1,
    });
    vi.mocked(listNotifications).mockResolvedValue({
      nextToken: "",
      notifications: [
        {
          createdAt: "2026-08-01T00:00:00Z",
          description: "テナントの公開設定を確認してください。",
          href: "/tenants/tenant_01",
          id: "notification_01",
          isRead: false,
          notificationType: "episode_publish_failed",
          title: "予約公開に失敗しました",
        },
      ],
      ok: true,
      previousToken: "",
    });

    render(await PlatformNotificationBell());

    expect(listNotifications).toHaveBeenCalledWith({ limit: 5 });
    fireEvent.click(screen.getByRole("button", { name: "通知、未読1件" }));
    expect(
      screen
        .getByRole("link", { name: /予約公開に失敗しました/u })
        .getAttribute("href")
    ).toBe("/tenants/tenant_01");
    expect(
      screen
        .getByRole("link", { name: "platform.notifications.menu_more" })
        .getAttribute("href")
    ).toBe("/notifications");
  });
});
