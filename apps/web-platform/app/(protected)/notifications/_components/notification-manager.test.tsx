// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "../../../../../../locales/en.json";
import type { NotificationItem } from "../notification-types";
import { NotificationManager } from "./notification-manager";

const notificationMessages = {
  "platform.common.next": "Next",
  "platform.common.previous": "Previous",
  "platform.notifications.card_description":
    "Operational events addressed to you. You can navigate to tenant details.",
  "platform.notifications.card_title": "Notifications",
  "platform.notifications.columns.action": "Actions",
  "platform.notifications.columns.at": "Date and time",
  "platform.notifications.columns.content": "Details",
  "platform.notifications.columns.status": "Status",
  "platform.notifications.empty_description":
    "Notifications for operational events, such as failed scheduled publishing, will appear here.",
  "platform.notifications.empty_page_description":
    "It may have been deleted in another operation. Move to the previous or next page.",
  "platform.notifications.empty_page_title":
    "There are no notifications to show on this page.",
  "platform.notifications.empty_title": "No notifications yet.",
  "platform.notifications.list_error": "Could not display notifications",
  "platform.notifications.mark_all_read": "Mark all as read",
  "platform.notifications.mark_read": "Mark as read",
  "platform.notifications.per_page": "Showing up to 20 per page, newest first.",
  "platform.notifications.read": "Read",
  "platform.notifications.unread": "Unread",
} as const;

vi.mock("#components/message", () => ({
  Message: ({ message }: { message: keyof typeof notificationMessages }) =>
    notificationMessages[message],
}));

vi.mock("#components/pagination-controls", () => ({
  PaginationControls: ({
    nextHref,
    previousHref,
  }: {
    nextHref?: string;
    previousHref?: string;
  }) => (
    <nav aria-label="Notifications pagination">
      {previousHref ? <a href={previousHref}>Previous</a> : null}
      {nextHref ? <a href={nextHref}>Next</a> : null}
    </nav>
  ),
}));

vi.mock("#lib/locale", () => ({
  getPlatformLocale: () => Promise.resolve("en"),
  loadPlatformMessages: () => Promise.resolve(en),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: React.ComponentProps<"a">) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("./notification-read-actions", () => ({
  MarkAllNotificationsAsReadButton: () => (
    <button type="button">Mark all as read</button>
  ),
  MarkNotificationAsReadButton: ({
    notificationId,
  }: {
    notificationId: string;
  }) => <button type="button">Mark as read {notificationId}</button>,
}));

const notification = (
  id: string,
  overrides: Partial<NotificationItem> = {}
): NotificationItem => ({
  createdAt: "2026-06-01T00:00:00Z",
  description: "Could not publish Episode 1 (Series A) for the tenant Acme.",
  href: "/tenants/SeedTNNTAAA1",
  id,
  isRead: false,
  notificationType: "episode_publish_failed",
  title: "Could not publish the episode",
  ...overrides,
});

afterEach(() => {
  cleanup();
});

describe("NotificationManager", () => {
  it("shows an empty state when the first page is empty", async () => {
    render(
      await NotificationManager({
        notifications: [],
        timeZone: "Asia/Tokyo",
        unreadCount: 0,
      })
    );

    expect(screen.getByText("No notifications yet.")).toBeDefined();
    expect(screen.queryByLabelText("Notifications pagination")).toBeNull();
    expect(screen.queryByText("Mark all as read")).toBeNull();
  });

  it("does not show an empty state when a later page is empty", async () => {
    render(
      await NotificationManager({
        notifications: [],
        previousHref: "/notifications?token=previous",
        timeZone: "Asia/Tokyo",
        unreadCount: 0,
      })
    );

    expect(
      screen.getByText("There are no notifications to show on this page.")
    ).toBeDefined();
    const previous = screen.getByRole("link", { name: "Previous" });
    expect(previous.getAttribute("href")).toBe("/notifications?token=previous");
  });

  it("renders unread rows, links, and read buttons", async () => {
    render(
      await NotificationManager({
        nextHref: "/notifications?token=next",
        notifications: [
          notification("n1"),
          notification("n2", {
            createdAt: "2026-05-31T00:00:00Z",
            href: undefined,
            isRead: true,
            title: "Notification",
          }),
        ],
        previousHref: "/notifications?token=previous",
        timeZone: "Asia/Tokyo",
        unreadCount: 1,
      })
    );

    const titleLink = screen.getByRole("link", {
      name: "Could not publish the episode",
    });
    expect(titleLink.getAttribute("href")).toBe("/tenants/SeedTNNTAAA1");
    expect(screen.getByText("Jun 1, 2026, 9:00 AM")).toBeDefined();
    expect(screen.getByText("Unread")).toBeDefined();
    expect(screen.getByText("Read")).toBeDefined();
    expect(screen.getByText("Mark as read n1")).toBeDefined();
    expect(screen.queryByText("Mark as read n2")).toBeNull();
    expect(screen.getByText("Mark all as read")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Previous" }).getAttribute("href")
    ).toBe("/notifications?token=previous");
    expect(
      screen.getByRole("link", { name: "Next" }).getAttribute("href")
    ).toBe("/notifications?token=next");
  });

  it("shows only an error when loading fails", async () => {
    render(
      await NotificationManager({
        listErrorMessage: "Could not load the notifications.",
        nextHref: "/notifications?token=next",
        notifications: [],
        previousHref: "/notifications?token=previous",
        timeZone: "Asia/Tokyo",
        unreadCount: 2,
      })
    );

    const sectionError = screen.getByRole("alert");
    expect(sectionError.textContent).toContain(
      "Could not display notifications"
    );
    expect(sectionError.textContent).toContain(
      "Could not load the notifications."
    );
    expect(screen.queryByText("No notifications yet.")).toBeNull();
    expect(screen.queryByLabelText("Notifications pagination")).toBeNull();
    expect(screen.queryByText("Mark all as read")).toBeNull();
  });

  it("shows creation times in the platform default time zone", async () => {
    render(
      await NotificationManager({
        notifications: [notification("n1")],
        timeZone: "America/Los_Angeles",
        unreadCount: 1,
      })
    );

    expect(screen.getByText("May 31, 2026, 5:00 PM")).toBeDefined();
    expect(screen.queryByText("Jun 1, 2026, 9:00 AM")).toBeNull();
  });
});
