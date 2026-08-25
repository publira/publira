// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLayout } from "./admin-layout";

vi.mock("@publira/layouts/admin", () => ({
  ConsoleHeader: ({
    brandMark,
    contextLabel,
  }: {
    brandMark?: ReactNode;
    contextLabel: string;
  }) => (
    <header>
      {brandMark}
      <p>{contextLabel}</p>
    </header>
  ),
  ConsoleHeaderUser: () => null,
  ConsoleHeaderUserSkeleton: () => null,
  ConsoleLayout: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ConsoleLayoutContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ConsoleLayoutMain: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
  ConsoleSidebar: ({
    brandMark,
    children,
    logoLabel,
  }: {
    brandMark?: ReactNode;
    children?: ReactNode;
    logoLabel: string;
  }) => (
    <aside>
      {brandMark}
      {logoLabel ? <p>{logoLabel}</p> : null}
      {children}
    </aside>
  ),
}));

vi.mock("../lib/admin-auth", () => ({
  getAdminCurrentUser: vi.fn(),
}));

vi.mock("../lib/auth-session", () => ({
  redirectToLoginIfSessionRejected: vi.fn(),
}));

vi.mock("../lib/logout-action", () => ({
  logoutAction: vi.fn(),
}));

vi.mock("../lib/notification", () => ({
  countUnreadNotifications: vi.fn(),
}));

vi.mock("../lib/tenant-id", () => ({
  getTenantId: vi.fn(),
}));

vi.mock("./notification-bell", () => ({
  NotificationBell: () => null,
  NotificationBellSkeleton: () => null,
}));

const tenant = {
  adminDomain: "admin.example.com",
  domain: "example.com",
  name: "青枝出版",
  publicId: "tenant_admin_001",
};

const logo = {
  updatedAt: "2026-08-19T00:00:00.000Z",
  variants: [
    {
      contentType: "image/png",
      fileSizeBytes: 1024,
      height: 64,
      label: "original",
      url: "/images/tenants/logo-1",
      variantType: "logo",
      width: 128,
    },
  ],
};

afterEach(() => {
  cleanup();
});

describe("AdminLayout", () => {
  it("ロゴがあるときはヘッダとサイドバーに出し、テナント名も残す", () => {
    render(
      <AdminLayout logo={logo} tenant={tenant}>
        <p>本文</p>
      </AdminLayout>
    );

    expect(screen.getAllByAltText("青枝出版のロゴ")).toHaveLength(2);
    expect(screen.getAllByText("青枝出版").length).toBeGreaterThan(0);
    expect(screen.queryByText("Publira")).toBeNull();
    expect(screen.queryByText("Admin Console")).toBeNull();
  });

  it("ロゴがないときはテナント名をブランドにし、製品名は出さない", () => {
    render(
      <AdminLayout logo={null} tenant={tenant}>
        <p>本文</p>
      </AdminLayout>
    );

    expect(screen.queryByAltText("青枝出版のロゴ")).toBeNull();
    expect(screen.queryByText("Publira")).toBeNull();
    expect(screen.queryByText("Admin Console")).toBeNull();
    expect(screen.getAllByText("青枝出版").length).toBeGreaterThan(0);
  });
});
