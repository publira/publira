// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SignupContent } from "./signup-content";

const { mockGetTenantSignUp } = vi.hoisted(() => ({
  mockGetTenantSignUp: vi.fn(),
}));

// `<Message>` is an async Server Component only the Next.js compiler can
// render; the catalog is the real one.
vi.mock("#components/message", () => ({
  Message: ({ message }: { message: MessageKey<SharedMessages> }) =>
    bindMessages(sharedCatalog("en"), "en")(message),
}));

vi.mock("#lib/tenant", () => ({ getTenantSignUp: mockGetTenantSignUp }));

vi.mock("#lib/tenant-id", () => ({
  getTenantId: () => Promise.resolve("tenant"),
}));

vi.mock("./signup-form", () => ({
  SignupFooter: () => <footer>Already have an account?</footer>,
  SignupForm: () => <form aria-label="Sign up" />,
}));

afterEach(cleanup);

describe("SignupContent", () => {
  it("offers the form while the tenant takes new readers", async () => {
    mockGetTenantSignUp.mockResolvedValueOnce({ open: true });

    render(await SignupContent());

    expect(screen.getByRole("form", { name: "Sign up" })).toBeDefined();
    expect(
      screen.queryByRole("heading", { name: "Sign-up is closed" })
    ).toBeNull();
  });

  it("shows the tenant's notice and no form while sign-up is closed", async () => {
    mockGetTenantSignUp.mockResolvedValueOnce({
      message: "We open again in spring.\nThank you for waiting.",
      open: false,
    });

    render(await SignupContent());

    expect(
      screen.getByRole("heading", { name: "Sign-up is closed" })
    ).toBeDefined();
    expect(
      screen.getByText(/We open again in spring\.\s+Thank you for waiting\./u)
    ).toBeDefined();
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.getByText("Already have an account?")).toBeDefined();
  });

  it("shows the site's own notice where the tenant wrote none", async () => {
    mockGetTenantSignUp.mockResolvedValueOnce({ open: false });

    render(await SignupContent());

    expect(
      screen.getByText("This site is not accepting new accounts right now.")
    ).toBeDefined();
    expect(screen.queryByRole("form")).toBeNull();
  });
});
