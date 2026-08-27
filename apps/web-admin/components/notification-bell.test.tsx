// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ja from "../../../locales/ja.json";
import { NotificationBell } from "./notification-bell";

const countUnreadNotifications = vi.fn();

vi.mock("#lib/locale", () => ({
  getLocale: () => Promise.resolve("ja"),
  loadAdminMessages: () => Promise.resolve(ja),
}));

vi.mock("#lib/notification", () => ({
  countUnreadNotifications: (tenantId: string) =>
    countUnreadNotifications(tenantId),
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

const renderBell = async (unreadCount: number) => {
  countUnreadNotifications.mockResolvedValue({ unreadCount });
  render(await NotificationBell());
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NotificationBell", () => {
  it("0 件なら件数を出さない", async () => {
    await renderBell(0);

    const link = screen.getByRole("link", { name: "通知、未読はありません" });
    expect(link.getAttribute("href")).toBe("/notifications");
    expect(link.textContent).not.toContain("0");
  });

  it("未読があれば件数を出す", async () => {
    await renderBell(3);

    expect(screen.getByRole("link", { name: "通知、未読3件" })).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
  });

  it("99 件を超えたら 99+ と出す", async () => {
    await renderBell(120);

    expect(screen.getByRole("link", { name: "通知、未読120件" })).toBeDefined();
    expect(screen.getByText("99+")).toBeDefined();
  });
});
