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
import {
  PlatformLayout,
  PlatformNotificationBell,
  PlatformUser,
} from "./platform-layout";

vi.mock("../lib/auth", () => ({
  getPlatformCurrentOperator: vi.fn(),
}));

vi.mock("../lib/auth-session", () => ({
  redirectToLoginIfSessionRejected: vi.fn(),
}));

vi.mock("../lib/locale", () => ({
  getPlatformLocale: vi.fn(() => Promise.resolve("en")),
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

describe("PlatformLayout", () => {
  it("asks the shared stylesheet for the platform console background", () => {
    const { container } = render(
      <PlatformLayout>
        <p>Body</p>
      </PlatformLayout>
    );

    expect(
      container.querySelector<HTMLElement>(".publira-console-background")
        ?.dataset.consoleTheme
    ).toBe("platform");
  });
});

describe("PlatformUser", () => {
  it.each([
    ["en", "Account menu for Avery Quinn"],
    ["ja", "Avery Quinnのアカウントメニュー"],
  ] as const)(
    "interpolates the name into the account menu aria-label in locale=%s",
    async (locale, expected) => {
      vi.mocked(getPlatformLocale).mockResolvedValue(locale);
      vi.mocked(getPlatformCurrentOperator).mockResolvedValue({
        ok: true,
        operator: {
          name: "Avery Quinn",
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
    ["en", "Display language: English"],
    ["ja", "表示言語: 日本語"],
  ] as const)(
    "names the current display language on the header trigger in locale=%s",
    async (locale, expected) => {
      vi.mocked(getPlatformLocale).mockResolvedValue(locale);

      render(await PlatformLocaleSwitcher());

      expect(screen.getByRole("button", { name: expected })).toBeDefined();
    }
  );
});

describe("PlatformNotificationBell", () => {
  it("shows the five most recent notifications in the menu and links to the notification list", async () => {
    vi.mocked(getPlatformLocale).mockResolvedValue("en");
    vi.mocked(countUnreadNotifications).mockResolvedValue({
      ok: true,
      unreadCount: 1,
    });
    vi.mocked(listNotifications).mockResolvedValue({
      nextToken: "",
      notifications: [
        {
          createdAt: "2026-08-01T00:00:00Z",
          description: "Check the publication settings of this tenant.",
          href: "/tenants/tenant_01",
          id: "notification_01",
          isRead: false,
          notificationType: "episode_publish_failed",
          title: "Scheduled publication failed",
        },
      ],
      ok: true,
      previousToken: "",
    });

    render(await PlatformNotificationBell());

    expect(listNotifications).toHaveBeenCalledWith("en", { limit: 5 });
    fireEvent.click(
      screen.getByRole("button", { name: "Notifications, 1 unread" })
    );
    expect(
      screen
        .getByRole("link", { name: /Scheduled publication failed/u })
        .getAttribute("href")
    ).toBe("/tenants/tenant_01");
    expect(
      screen
        .getByRole("link", { name: "platform.notifications.menu_more" })
        .getAttribute("href")
    ).toBe("/notifications");
  });
});
