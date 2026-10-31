// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TenantBrandMarkKind, TenantImageVariant } from "#lib/tenant";

import { SocialSignInButtons } from "./social-sign-in-buttons";

const { mockGetTenantSignInClients, mockGetTenantSiteInfo } = vi.hoisted(
  () => ({
    mockGetTenantSignInClients: vi.fn(),
    mockGetTenantSiteInfo: vi.fn(),
  })
);

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
  getTenantSiteInfo: mockGetTenantSiteInfo,
}));

vi.mock("#lib/tenant-id", () => ({
  getTenantId: () => Promise.resolve("tenant"),
}));

afterEach(cleanup);

const markVariant = (kind: TenantBrandMarkKind): TenantImageVariant => ({
  contentType: "image/png",
  fileSizeBytes: 1024,
  height: 40,
  label: "original",
  url: `/images/tenants/media-1/${kind}`,
  variantType: kind,
  width: 32,
});

const BOTH_PROVIDERS = {
  apple: "com.example.web",
  google: "web-client",
};

describe("SocialSignInButtons", () => {
  it("renders nothing where the tenant offers no provider", async () => {
    mockGetTenantSignInClients.mockResolvedValueOnce({});
    mockGetTenantSiteInfo.mockResolvedValueOnce(null);

    await expect(SocialSignInButtons({ returnTo: "/" })).resolves.toBeNull();
  });

  it("keeps the divider for a way in the caller offers where the tenant offers no provider", async () => {
    mockGetTenantSignInClients.mockResolvedValueOnce({});
    mockGetTenantSiteInfo.mockResolvedValueOnce(null);

    render(
      await SocialSignInButtons({
        children: (
          <form>
            <button type="submit">Sign in with a passkey</button>
          </form>
        ),
        returnTo: "/",
      })
    );

    expect(screen.getByText("or")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Sign in with a passkey" })
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Continue/u })).toBeNull();
  });

  it("offers each provider the tenant enabled, returning to where the reader was going", async () => {
    mockGetTenantSignInClients.mockResolvedValueOnce({ google: "web-client" });
    mockGetTenantSiteInfo.mockResolvedValueOnce(null);

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

  it.each([
    {
      kind: "apple_sign_in",
      name: "Continue with Apple",
      other: "Continue with Google",
    },
    {
      kind: "google_sign_in",
      name: "Continue with Google",
      other: "Continue with Apple",
    },
  ] as const)(
    "draws the $kind mark the tenant uploaded at the head of its button",
    async ({ kind, name, other }) => {
      mockGetTenantSignInClients.mockResolvedValueOnce(BOTH_PROVIDERS);
      mockGetTenantSiteInfo.mockResolvedValueOnce({
        brandMarks: { [kind]: [markVariant(kind)] },
      });

      render(await SocialSignInButtons({ returnTo: "/" }));

      const button = screen.getByRole("button", { name });
      const mark = button.firstElementChild;
      expect(mark?.tagName).toBe("IMG");
      expect(mark?.getAttribute("alt")).toBe("");
      expect(mark?.getAttribute("width")).toBe("32");
      expect(mark?.getAttribute("height")).toBe("40");
      expect(decodeURIComponent(mark?.getAttribute("src") ?? "")).toContain(
        `/images/tenants/media-1/${kind}`
      );

      const unmarked = screen.getByRole("button", { name: other });
      expect(unmarked.querySelector("img")).toBeNull();
      expect(unmarked.textContent).toBe(other);
    }
  );

  it("renders each button as its label alone where the tenant uploaded no mark", async () => {
    mockGetTenantSignInClients.mockResolvedValueOnce(BOTH_PROVIDERS);
    mockGetTenantSiteInfo.mockResolvedValueOnce({});

    render(await SocialSignInButtons({ returnTo: "/" }));

    for (const name of ["Continue with Apple", "Continue with Google"]) {
      const button = screen.getByRole("button", { name });
      expect(button.querySelector("img")).toBeNull();
      expect(button.textContent).toBe(name);
    }
  });
});
