// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotificationBell } from "./notification-bell";

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

describe("NotificationBell", () => {
  it("0 件なら件数を出さない", () => {
    render(<NotificationBell unreadCount={0} />);

    const link = screen.getByRole("link", { name: "通知、未読はありません" });
    expect(link.getAttribute("href")).toBe("/ja/notifications");
    expect(link.textContent).not.toContain("0");
  });

  it("未読があれば件数を出す", () => {
    render(<NotificationBell unreadCount={3} />);

    expect(screen.getByRole("link", { name: "通知、未読3件" })).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
  });

  it("99 件を超えたら 99+ と出す", () => {
    render(<NotificationBell unreadCount={120} />);

    expect(screen.getByRole("link", { name: "通知、未読120件" })).toBeDefined();
    expect(screen.getByText("99+")).toBeDefined();
  });
});
