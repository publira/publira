// @vitest-environment jsdom

import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotificationBell } from "./notification-bell";

const countUnreadNotifications = vi.fn();
const listNotifications = vi.fn();

vi.mock("#lib/locale", () => ({
  getLocale: () => Promise.resolve("en"),
  loadAdminMessages: () => Promise.resolve(sharedCatalog("en")),
}));

vi.mock("#lib/notification", () => ({
  countUnreadNotifications: (tenantId: string, locale: string) =>
    countUnreadNotifications(tenantId, locale),
  listNotifications: (
    tenantId: string,
    locale: string,
    options: { limit: number }
  ) => listNotifications(tenantId, locale, options),
}));

vi.mock("#lib/tenant-id", () => ({
  getTenantId: () => Promise.resolve("tenant-1"),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const renderBell = async ({
  notifications = [],
  unreadCount = 0,
}: {
  notifications?: {
    createdAt: string;
    description: string;
    href?: string;
    id: string;
    isRead: boolean;
    notificationType: string;
    title: string;
  }[];
  unreadCount?: number;
} = {}) => {
  countUnreadNotifications.mockResolvedValue({ ok: true, unreadCount });
  listNotifications.mockResolvedValue({
    nextToken: "",
    notifications,
    ok: true,
    previousToken: "",
  });
  render(await NotificationBell());
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NotificationBell", () => {
  it("hides the count and shows the empty state with a link to the notification list when there is none", async () => {
    await renderBell();

    const trigger = screen.getByRole("button", {
      name: "Notifications, none unread",
    });
    expect(trigger.textContent).not.toContain("0");
    expect(listNotifications).toHaveBeenCalledWith("tenant-1", "en", {
      limit: 5,
    });

    fireEvent.click(trigger);
    expect(screen.getByText("You have no notifications yet.")).toBeDefined();
    expect(
      screen.getByText(/operational events such as scheduled publication/u)
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: "View all" }).getAttribute("href")
    ).toBe("/notifications");
  });

  it("shows the count and where the latest notification leads when there are unread ones", async () => {
    await renderBell({
      notifications: [
        {
          createdAt: "2026-08-30T00:00:00Z",
          description: "Check the publication settings.",
          href: "/series/SR01",
          id: "notification-1",
          isRead: false,
          notificationType: "episode_publish_failed",
          title: "An episode could not be published",
        },
      ],
      unreadCount: 3,
    });

    const trigger = screen.getByRole("button", {
      name: "Notifications, 3 unread",
    });
    expect(screen.getByText("3")).toBeDefined();

    fireEvent.click(trigger);
    expect(
      screen
        .getByRole("link", { name: /An episode could not be published/u })
        .getAttribute("href")
    ).toBe("/series/SR01");
    expect(screen.getByText("Unread")).toBeDefined();
  });

  it("shows 99+ beyond ninety-nine", async () => {
    await renderBell({ unreadCount: 120 });

    expect(
      screen.getByRole("button", { name: "Notifications, 120 unread" })
    ).toBeDefined();
    expect(screen.getByText("99+")).toBeDefined();
  });

  it("keeps the menu and the link to all notifications when the fetch fails", async () => {
    countUnreadNotifications.mockResolvedValue({ ok: true, unreadCount: 0 });
    listNotifications.mockResolvedValue({
      message: "Could not load your notifications. Please try again later.",
      nextToken: "",
      notifications: [],
      ok: false,
      previousToken: "",
      requiresSignIn: false,
    });
    render(await NotificationBell());

    fireEvent.click(
      screen.getByRole("button", { name: "Notifications, none unread" })
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "Could not load your notifications. Please try again later."
    );
    expect(screen.getByRole("link", { name: "View all" })).toBeDefined();
  });
});
