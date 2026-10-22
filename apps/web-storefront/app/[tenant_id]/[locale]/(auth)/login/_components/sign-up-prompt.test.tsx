// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RefusedSignUpNotice, SignUpPrompt } from "./sign-up-prompt";

const { mockGetTenantSignUp } = vi.hoisted(() => ({
  mockGetTenantSignUp: vi.fn(),
}));

// `<Message>` is an async Server Component only the Next.js compiler can
// render; the catalog is the real one.
vi.mock("#components/message", () => ({
  Message: ({ message }: { message: MessageKey<SharedMessages> }) =>
    bindMessages(sharedCatalog("en"), "en")(message),
}));

vi.mock("#components/locale-link", () => ({
  LocaleLink: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={`/en${href}`}>{children}</a>
  ),
}));

vi.mock("#lib/tenant", () => ({ getTenantSignUp: mockGetTenantSignUp }));

vi.mock("#lib/tenant-id", () => ({
  getTenantId: () => Promise.resolve("tenant"),
}));

afterEach(cleanup);

describe("SignUpPrompt", () => {
  it("links to the sign-up screen while the tenant takes new readers", async () => {
    mockGetTenantSignUp.mockResolvedValueOnce({ open: true });

    render(await SignUpPrompt({ refused: false }));

    expect(screen.getByRole("link", { name: "Sign up" })).toBeDefined();
  });

  it("puts the tenant's notice in place of the link while sign-up is closed", async () => {
    mockGetTenantSignUp.mockResolvedValueOnce({
      message: "Invitations only for now.",
      open: false,
    });

    render(await SignUpPrompt({ refused: false }));

    expect(screen.getByText("Invitations only for now.")).toBeDefined();
    expect(screen.queryByRole("link", { name: "Sign up" })).toBeNull();
  });

  it("says nothing more once a refused sign-in already shows the notice", async () => {
    mockGetTenantSignUp.mockResolvedValueOnce({ open: false });

    await expect(SignUpPrompt({ refused: true })).resolves.toBeNull();
  });

  it("offers no link to a sign-up the API just refused", async () => {
    mockGetTenantSignUp.mockResolvedValueOnce({ open: true });

    await expect(SignUpPrompt({ refused: true })).resolves.toBeNull();
  });
});

describe("RefusedSignUpNotice", () => {
  it("words the refusal in the tenant's notice", async () => {
    mockGetTenantSignUp.mockResolvedValueOnce({
      message: "Invitations only for now.",
      open: false,
    });

    render(await RefusedSignUpNotice());

    expect(
      screen.getByRole("heading", { name: "Sign-up is closed" })
    ).toBeDefined();
    expect(screen.getByText("Invitations only for now.")).toBeDefined();
  });

  it("falls back to the site's notice while the cached read still says open", async () => {
    mockGetTenantSignUp.mockResolvedValueOnce({ open: true });

    render(await RefusedSignUpNotice());

    expect(
      screen.getByText("This site is not accepting new accounts right now.")
    ).toBeDefined();
  });
});
