// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getAdminCurrentUser } from "#lib/admin-auth";

import { MembersNavigationItem } from "./members-navigation-item";

vi.mock("#components/message", () => ({
  Message: ({ message }: { message: MessageKey<SharedMessages> }) =>
    bindMessages(sharedCatalog("en"))(message),
}));

vi.mock("#lib/tenant-id", () => ({
  getTenantId: () => Promise.resolve("TENANT001"),
}));

vi.mock("#lib/admin-auth", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAdminCurrentUser: vi.fn(),
}));

vi.mock("@publira/layouts/admin", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ConsoleSidebarNavigationItem: ({
    children,
    href,
  }: {
    children: ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const signedInAs = (role: string) => {
  vi.mocked(getAdminCurrentUser).mockResolvedValue({
    ok: true,
    user: { name: "Operator", publicId: "USER001", role },
  });
};

afterEach(() => {
  cleanup();
});

describe("MembersNavigationItem", () => {
  it("links a tenant admin to the members screen", async () => {
    signedInAs("tenant_admin");

    render(await MembersNavigationItem());

    expect(
      screen.getByRole("link", { name: "Members" }).getAttribute("href")
    ).toBe("/members");
  });

  it.each(["tenant_editor", "tenant_auditor"])(
    "is not shown to a %s",
    async (role) => {
      signedInAs(role);

      expect(await MembersNavigationItem()).toBeNull();
    }
  );

  it("is not shown when the operator could not be read", async () => {
    vi.mocked(getAdminCurrentUser).mockResolvedValue({
      ok: false,
      requiresSignIn: false,
    });

    expect(await MembersNavigationItem()).toBeNull();
  });
});
