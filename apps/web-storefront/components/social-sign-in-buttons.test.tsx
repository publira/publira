// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SocialSignInButtons } from "./social-sign-in-buttons";

const { mockGetTenantSignInClients } = vi.hoisted(() => ({
  mockGetTenantSignInClients: vi.fn(),
}));

// `<Message>` is an async Server Component only the Next.js compiler can
// render; the catalog is the real one.
vi.mock("#components/message", () => ({
  Message: ({ message }: { message: MessageKey<SharedMessages> }) =>
    bindMessages(sharedCatalog("en"), "en")(message),
}));

vi.mock("#components/locale-field", () => ({
  LocaleField: () => <input name="locale" type="hidden" value="en" />,
}));

vi.mock("#components/tenant-id-field", () => ({
  TenantIdField: () => <input name="tenantId" type="hidden" value="tenant" />,
}));

vi.mock("#lib/social-sign-in-actions", () => ({
  startSocialSignInAction: vi.fn(),
}));

vi.mock("#lib/tenant", () => ({
  getTenantSignInClients: mockGetTenantSignInClients,
}));

vi.mock("#lib/tenant-id", () => ({
  getTenantId: () => Promise.resolve("tenant"),
}));

afterEach(cleanup);

describe("SocialSignInButtons", () => {
  it("renders nothing where the tenant offers no provider", async () => {
    mockGetTenantSignInClients.mockResolvedValueOnce({});

    await expect(SocialSignInButtons({ returnTo: "/" })).resolves.toBeNull();
  });

  it("offers each provider the tenant enabled, returning to where the reader was going", async () => {
    mockGetTenantSignInClients.mockResolvedValueOnce({ google: "web-client" });

    render(await SocialSignInButtons({ returnTo: "/series" }));

    const button = screen.getByRole("button", {
      name: "Continue with Google",
    });
    expect(
      screen.queryByRole("button", { name: "Continue with Apple" })
    ).toBeNull();
    const form = button.closest("form");
    expect(Object.fromEntries(new FormData(form ?? undefined))).toEqual({
      intent: "login",
      locale: "en",
      provider: "google",
      returnTo: "/series",
      tenantId: "tenant",
    });
  });
});
