// @vitest-environment jsdom

import { setImmediate } from "node:timers/promises";

import { bindMessages } from "@publira/i18n";
import type { Locale, MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAdminCurrentUser } from "../lib/admin-auth";
import { verifyAdminSession } from "../lib/auth-session";
import { getLocale } from "../lib/locale";
import { logoutAction } from "../lib/logout-action";
import { getTenantName } from "../lib/public-api";
import { renderServerComponent } from "../lib/render-server-component";
import { getTenantThemeLogo } from "../lib/theme-settings";
import {
  AdminHeaderBrand,
  AdminHeaderTenantName,
  AdminLayout,
  AdminSidebarBrandMark,
  AdminSidebarContext,
  AdminUser,
} from "./admin-layout";
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
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("ja"))(message, values),
}));

vi.mock("../lib/admin-auth", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAdminCurrentUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  usePathname: () => "/series",
}));

vi.mock("../lib/auth-session", () => ({
  isSignedInTenantAdmin: vi.fn(() => Promise.resolve(true)),
  verifyAdminSession: vi.fn(),
}));

vi.mock("../lib/locale", () => ({
  getLocale: vi.fn(() => Promise.resolve("ja")),
  loadAdminMessages: (locale: Locale) => Promise.resolve(sharedCatalog(locale)),
}));

vi.mock("../lib/logout-action", () => ({
  logoutAction: vi.fn(),
}));

vi.mock("../lib/public-api", () => ({
  getTenantName: vi.fn(),
}));

vi.mock("../lib/tenant-id", () => ({
  getTenantId: vi.fn(() => Promise.resolve("tenant-id")),
}));

vi.mock("../lib/theme-settings", () => ({
  getTenantThemeLogo: vi.fn(),
}));

vi.mock("./notification-bell", () => ({
  NotificationBell: () => null,
  NotificationBellSkeleton: () => null,
}));

vi.mock("./pending-comment-badge", () => ({
  PendingCommentBadge: () => null,
}));

const operator = {
  name: "Avery Quinn",
  publicId: "user_admin_001",
  role: "tenant_owner",
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

beforeEach(() => {
  vi.mocked(getTenantName).mockResolvedValue("Acme Publishing");
  vi.mocked(getTenantThemeLogo).mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
});

/** Every part of the chrome that names the tenant, as the layout places them. */
const renderTenantChrome = async () =>
  render(
    <>
      {await AdminSidebarBrandMark()}
      {await AdminSidebarContext()}
      {await AdminHeaderBrand()}
      <p>{await AdminHeaderTenantName()}</p>
    </>
  );

describe("AdminLayout", () => {
  beforeEach(() => {
    vi.mocked(getLocale).mockResolvedValue("en");
    vi.mocked(verifyAdminSession).mockResolvedValue(operator);
    // The members link in the navigation reads the operator's role itself.
    vi.mocked(getAdminCurrentUser).mockResolvedValue({
      ok: true,
      user: operator,
    });
  });

  it("renders the screen before the tenant and the session are read", async () => {
    vi.mocked(getTenantName).mockReturnValue(
      Promise.withResolvers<never>().promise
    );
    vi.mocked(verifyAdminSession).mockReturnValue(
      Promise.withResolvers<never>().promise
    );
    vi.mocked(getAdminCurrentUser).mockReturnValue(
      Promise.withResolvers<never>().promise
    );
    const controller = new AbortController();

    const rendering = renderServerComponent(
      <AdminLayout>
        <p>Body</p>
      </AdminLayout>,
      { signal: controller.signal }
    );
    // The shell renders in a microtask, so it is complete once a macrotask
    // has run; what still waits on the tenant or the session is cut off here.
    await setImmediate();
    controller.abort();
    await rendering;

    expect(screen.getByText("Body")).toBeDefined();
    expect(screen.queryByText("Acme Publishing")).toBeNull();
  });

  it("puts the language and account controls in the header", async () => {
    await renderServerComponent(
      <AdminLayout>
        <p>Body</p>
      </AdminLayout>
    );

    const header = screen.getByRole("banner");
    expect(
      within(header).getByRole("button", { name: "Display language" })
    ).toBeDefined();
    expect(
      within(header).getByRole("button", {
        name: "Account menu for Avery Quinn",
      })
    ).toBeDefined();
    expect(within(header).getByText("Acme Publishing")).toBeDefined();
  });

  it("labels the button that opens the navigation on a narrow screen", async () => {
    await renderServerComponent(
      <AdminLayout>
        <p>Body</p>
      </AdminLayout>
    );

    expect(
      screen.getByRole("button", { name: "Open navigation" })
    ).toBeDefined();
  });

  it("marks the navigation item for the screen the console is on", async () => {
    await renderServerComponent(
      <AdminLayout>
        <p>Body</p>
      </AdminLayout>
    );

    expect(
      screen
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current") === "page")
        .map((link) => link.getAttribute("href"))
    ).toEqual(["/series"]);
  });
});

describe("the tenant chrome", () => {
  it("puts the logo in the header and the sidebar and keeps the tenant name", async () => {
    vi.mocked(getTenantThemeLogo).mockResolvedValue(logo);

    await renderTenantChrome();

    expect(screen.getAllByAltText("Acme Publishing logo")).toHaveLength(2);
    expect(screen.getAllByText("Acme Publishing").length).toBeGreaterThan(0);
    expect(screen.queryByText("Publira")).toBeNull();
    expect(screen.queryByText("Admin Console")).toBeNull();
  });

  it("makes the tenant name the brand and hides the product name when there is no logo", async () => {
    await renderTenantChrome();

    expect(screen.queryByAltText("Acme Publishing logo")).toBeNull();
    expect(screen.queryByText("Publira")).toBeNull();
    expect(screen.queryByText("Admin Console")).toBeNull();
    expect(screen.getAllByText("Acme Publishing")).toHaveLength(2);
  });

  it("reads the tenant name from the public tenant read", async () => {
    await renderTenantChrome();

    expect(getTenantName).toHaveBeenCalledWith("tenant-id");
  });

  it("names no tenant while the public tenant read fails", async () => {
    vi.mocked(getTenantName).mockResolvedValue(null);

    await expect(AdminHeaderTenantName()).resolves.toBe("");
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
      vi.mocked(verifyAdminSession).mockResolvedValue(operator);

      render(await AdminUser());

      expect(screen.getByRole("button", { name: expected })).toBeDefined();
    }
  );

  it("verifies the session against the tenant the console is serving", async () => {
    vi.mocked(getLocale).mockResolvedValue("en");
    vi.mocked(verifyAdminSession).mockResolvedValue(operator);
    const bind = vi.spyOn(
      logoutAction as unknown as { bind: (...args: unknown[]) => unknown },
      "bind"
    );

    render(await AdminUser());

    expect(verifyAdminSession).toHaveBeenCalledWith("tenant-id");
    // The logout revokes the session on the tenant it was issued for.
    expect(bind).toHaveBeenCalledWith(null, "tenant-id");
  });

  it("lets the login redirect of a rejected session through", async () => {
    vi.mocked(verifyAdminSession).mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(AdminUser()).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("AdminLocaleSwitcher", () => {
  it.each([
    ["en", "Display language"],
    ["ja", "表示言語"],
  ] as const)(
    "names the display-language control in %s",
    async (locale, expected) => {
      vi.mocked(getLocale).mockResolvedValue(locale);

      render(await AdminLocaleSwitcher());

      expect(screen.getByRole("button", { name: expected })).toBeDefined();
    }
  );
});
