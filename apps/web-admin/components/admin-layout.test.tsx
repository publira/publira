// @vitest-environment jsdom

import { getMessage } from "@publira/i18n";
import type { Locale, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getAdminCurrentUser } from "../lib/admin-auth";
import { getLocale } from "../lib/locale";
import { AdminLayout, AdminUser } from "./admin-layout";

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

// 代替テキストの解決は `admin-brand-logo.test.tsx` が見る。ここではロゴが
// ヘッダとサイドバーの両方に置かれることだけを確かめたい。
vi.mock("./admin-brand-logo", () => ({
  AdminBrandLogo: ({ tenantName }: { tenantName: string }) => (
    // oxlint-disable-next-line next/no-img-element -- stub for the real logo
    <img alt={`${tenantName}のロゴ`} src="/images/tenants/logo-1" />
  ),
}));

vi.mock("./message", () => ({
  Message: ({ message, values }: { message: string; values?: MessageValues }) =>
    getMessage(sharedCatalog("ja"), message, values),
}));

vi.mock("../lib/admin-auth", () => ({
  getAdminCurrentUser: vi.fn(),
}));

vi.mock("../lib/auth-session", () => ({
  redirectToLoginIfSessionRejected: vi.fn(),
}));

vi.mock("../lib/locale", () => ({
  getLocale: vi.fn(() => Promise.resolve("ja")),
  loadAdminMessages: (locale: Locale) => Promise.resolve(sharedCatalog(locale)),
}));

vi.mock("../lib/logout-action", () => ({
  logoutAction: vi.fn(),
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

describe("AdminUser", () => {
  it.each([
    ["ja", "青枝 花子のアカウントメニュー"],
    ["en", "Account menu for 青枝 花子"],
  ] as const)(
    "%s のアカウントメニューの aria-label に氏名を補間する",
    async (locale, expected) => {
      vi.mocked(getLocale).mockResolvedValue(locale);
      vi.mocked(getAdminCurrentUser).mockResolvedValue({
        ok: true,
        user: {
          name: "青枝 花子",
          publicId: "user_admin_001",
          role: "tenant_owner",
        },
      });

      render(await AdminUser({ logoutAction: () => Promise.resolve() }));

      expect(screen.getByRole("button", { name: expected })).toBeDefined();
    }
  );
});
