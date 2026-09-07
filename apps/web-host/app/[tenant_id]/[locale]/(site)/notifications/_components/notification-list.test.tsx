// @vitest-environment jsdom

import { getMessage } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NotificationItem } from "../notification-types";
import { NotificationList } from "./notification-list";

// `<Message>` is an async Server Component, which the client renderer cannot
// mount. It resolves through the real catalog here, so the assertions stay on
// the copy a reader actually sees.
vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => getMessage(sharedCatalog("en"), message, values),
}));

vi.mock("#components/locale-provider", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "en",
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: React.ComponentProps<"a">) => (
    <a href={href}>{children}</a>
  ),
}));

// `getLocale()` reads `next/root-params`, which only the Next.js compiler can
// provide. The catalog is the real one, so the assertions stay on the copy a
// reader actually sees.
vi.mock("#lib/locale", () => ({
  getLocale: () => Promise.resolve("en"),
  loadHostMessages: () => Promise.resolve(sharedCatalog("en")),
}));

vi.mock("./notification-read-actions", () => ({
  MarkAllNotificationsAsReadButton: ({ tenantId }: { tenantId: string }) => (
    <button type="button">Mark all as read {tenantId}</button>
  ),
  MarkNotificationAsReadButton: ({
    notificationId,
  }: {
    notificationId: string;
  }) => <button type="button">Mark as read {notificationId}</button>,
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const notification = (
  id: string,
  overrides: Partial<NotificationItem> = {}
): NotificationItem => ({
  createdAt: "2026-06-01T00:00:00Z",
  description: "“Episode 1” (Series A) is now available.",
  href: "/series/SR01/episodes/EP01",
  id,
  isRead: false,
  notificationType: "episode_published",
  title: "A new episode has been published",
  ...overrides,
});

/**
 * The component is an async Server Component, which the client renderer cannot
 * mount on its own: awaiting it here hands `render` the element tree it
 * produced.
 */
const renderList = async (
  props: Partial<React.ComponentProps<typeof NotificationList>> = {}
) => {
  const list = await NotificationList({
    nextToken: "",
    notifications: [],
    previousToken: "",
    tenantId,
    timeZone: "Asia/Tokyo",
    token: "",
    unreadCount: 0,
    ...props,
  });
  render(list);
};

afterEach(() => {
  cleanup();
});

describe("NotificationList", () => {
  it("The empty notification state is displayed when the first page is empty.", async () => {
    await renderList();

    expect(screen.getByText("You have no notifications yet.")).toBeDefined();
    expect(screen.queryByLabelText("Notifications pagination")).toBeNull();
    expect(screen.queryByText(`Mark all as read ${tenantId}`)).toBeNull();
  });

  it("Even if the destination of the page is empty, it will not notify you that the entire list is empty.", async () => {
    await renderList({ previousToken: "previous", token: "current" });

    expect(
      screen.getByText("There are no notifications on this page.")
    ).toBeDefined();
    const previous = screen.getByRole("link", { name: "Previous page" });
    expect(previous.getAttribute("href")).toBe("/notifications?token=previous");
  });

  it("Draw unread lines, links, and read buttons", async () => {
    await renderList({
      nextToken: "next",
      notifications: [
        notification("n1"),
        notification("n2", {
          createdAt: "2026-05-31T00:00:00Z",
          href: undefined,
          isRead: true,
          title: "Notification",
        }),
      ],
      previousToken: "previous",
      unreadCount: 1,
    });

    const titleLink = screen.getByRole("link", {
      name: "A new episode has been published",
    });
    expect(titleLink.getAttribute("href")).toBe("/series/SR01/episodes/EP01");
    expect(screen.getByText("Jun 1, 2026, 9:00 AM")).toBeDefined();
    expect(screen.getByText("Unread")).toBeDefined();
    expect(screen.getByText("Read")).toBeDefined();
    expect(screen.getByText("Mark as read n1")).toBeDefined();
    expect(screen.queryByText("Mark as read n2")).toBeNull();
    expect(screen.getByText(`Mark all as read ${tenantId}`)).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Previous page" }).getAttribute("href")
    ).toBe("/notifications?token=previous");
    expect(
      screen.getByRole("link", { name: "Next page" }).getAttribute("href")
    ).toBe("/notifications?token=next");
  });

  it("If acquisition fails, only an error will be displayed and an empty list will not be displayed.", async () => {
    await renderList({
      listErrorMessage: "Could not load your notifications.",
      nextToken: "next",
      previousToken: "previous",
      unreadCount: 2,
    });

    const sectionError = screen.getByRole("alert");
    expect(sectionError.textContent).toContain(
      "Could not display your notifications"
    );
    expect(sectionError.textContent).toContain(
      "Could not load your notifications."
    );
    expect(screen.queryByText("You have no notifications yet.")).toBeNull();
    expect(screen.queryByLabelText("Notifications pagination")).toBeNull();
    expect(screen.queryByText(`Mark all as read ${tenantId}`)).toBeNull();
  });

  it("Display the creation date and time on the tenant time zone wall clock", async () => {
    await renderList({
      notifications: [notification("n1")],
      timeZone: "America/Los_Angeles",
      unreadCount: 1,
    });

    expect(screen.getByText("May 31, 2026, 5:00 PM")).toBeDefined();
    expect(screen.queryByText("Jun 1, 2026, 9:00 AM")).toBeNull();
  });
});
