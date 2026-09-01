// @vitest-environment jsdom

import { getMessage } from "@publira/i18n";
import type { Locale, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getAdminCurrentUser } from "../lib/admin-auth";
import { getLocale } from "../lib/locale";
import { AdminLayout, AdminUser } from "./admin-layout";
import { AdminLocaleSwitcher } from "./locale-switcher";

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
  it("puts the logo in the header and the sidebar and keeps the tenant name", () => {
    render(
      <AdminLayout logo={logo} tenant={tenant} tenantId="tenant-id">
        <p>本文</p>
      </AdminLayout>
    );

    expect(screen.getAllByAltText("青枝出版のロゴ")).toHaveLength(2);
    expect(screen.getAllByText("青枝出版").length).toBeGreaterThan(0);
    expect(screen.queryByText("Publira")).toBeNull();
    expect(screen.queryByText("Admin Console")).toBeNull();
  });

  it("makes the tenant name the brand and hides the product name when there is no logo", () => {
    render(
      <AdminLayout logo={null} tenant={tenant} tenantId="tenant-id">
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
    "interpolates the name into the aria-label of the account menu in %s",
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

describe("AdminLocaleSwitcher", () => {
  it.each([
    ["ja", "表示言語: 日本語"],
    ["en", "Display language: English"],
  ] as const)(
    "shows the current display locale on the header trigger in %s",
    async (locale, expected) => {
      vi.mocked(getLocale).mockResolvedValue(locale);

      render(await AdminLocaleSwitcher({ tenantId: "tenant-id" }));

      expect(screen.getByRole("button", { name: expected })).toBeDefined();
    }
  );
});
