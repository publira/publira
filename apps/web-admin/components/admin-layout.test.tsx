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

// `admin-brand-logo.test.tsx` covers how the alternative text is resolved.
// All that matters here is that the logo appears in both the header and the
// sidebar.
vi.mock("./admin-brand-logo", () => ({
  AdminBrandLogo: ({ tenantName }: { tenantName: string }) => (
    // oxlint-disable-next-line next/no-img-element -- stub for the real logo
    <img alt={`${tenantName} logo`} src="/images/tenants/logo-1" />
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
  name: "Acme Publishing",
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
        <p>Body</p>
      </AdminLayout>
    );

    expect(screen.getAllByAltText("Acme Publishing logo")).toHaveLength(2);
    expect(screen.getAllByText("Acme Publishing").length).toBeGreaterThan(0);
    expect(screen.queryByText("Publira")).toBeNull();
    expect(screen.queryByText("Admin Console")).toBeNull();
  });

  it("makes the tenant name the brand and hides the product name when there is no logo", () => {
    render(
      <AdminLayout logo={null} tenant={tenant} tenantId="tenant-id">
        <p>Body</p>
      </AdminLayout>
    );

    expect(screen.queryByAltText("Acme Publishing logo")).toBeNull();
    expect(screen.queryByText("Publira")).toBeNull();
    expect(screen.queryByText("Admin Console")).toBeNull();
    expect(screen.getAllByText("Acme Publishing").length).toBeGreaterThan(0);
  });

  it("asks the shared stylesheet for the admin console background", () => {
    const { container } = render(
      <AdminLayout logo={null} tenant={tenant} tenantId="tenant-id">
        <p>Body</p>
      </AdminLayout>
    );

    expect(
      container.querySelector<HTMLElement>(".publira-console-background")
        ?.dataset.consoleTheme
    ).toBe("admin");
  });
});

describe("AdminUser", () => {
  it.each([
    ["en", "Account menu for Avery Quinn"],
    ["ja", "Avery Quinnのアカウントメニュー"],
  ] as const)(
    "interpolates the name into the aria-label of the account menu in %s",
    async (locale, expected) => {
      vi.mocked(getLocale).mockResolvedValue(locale);
      vi.mocked(getAdminCurrentUser).mockResolvedValue({
        ok: true,
        user: {
          name: "Avery Quinn",
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
    ["en", "Display language: English"],
    ["ja", "表示言語: 日本語"],
  ] as const)(
    "shows the current display locale on the header trigger in %s",
    async (locale, expected) => {
      vi.mocked(getLocale).mockResolvedValue(locale);

      render(await AdminLocaleSwitcher({ tenantId: "tenant-id" }));

      expect(screen.getByRole("button", { name: expected })).toBeDefined();
    }
  );
});
