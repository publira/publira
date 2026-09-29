// @vitest-environment jsdom

import { getLocales } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MessageProps } from "#components/message";
import type { PlatformAuditLogSummary } from "#lib/audit-logs";
import { getMessagesFor } from "#lib/messages";
import type { PlatformMessageAccessor } from "#lib/messages";

import { AuditLogTarget } from "./audit-log-target";

const state = vi.hoisted(() => ({
  t: undefined as PlatformMessageAccessor | undefined,
}));

// The real catalog, resolved ahead so the tree renders without suspending.
vi.mock("#components/message", () => ({
  Message: ({ message, values }: MessageProps) => state.t?.(message, values),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const renderTarget = async (
  log: Partial<PlatformAuditLogSummary>,
  locale: Locale = "en"
) => {
  state.t = await getMessagesFor(locale);

  return render(
    <AuditLogTarget
      log={{
        action: "tenant_admin_invited",
        actorName: "",
        actorRole: "",
        actorUserPublicId: "",
        createdAt: "",
        outcome: "success",
        reason: "",
        targetId: "",
        targetName: "",
        targetPublicId: "",
        targetType: "",
        tenantId: "",
        tenantName: "",
        ...log,
      }}
    />
  );
};

const invitation = {
  targetId: "0199a5e4-7c1b-7d2e-9f3a-1b2c3d4e5f60",
  targetName: "invitee@example.com",
  targetType: "tenant_admin_invitation",
  tenantId: "acme",
  tenantName: "Acme Comics",
} satisfies Partial<PlatformAuditLogSummary>;

beforeEach(() => {
  state.t = undefined;
});

afterEach(() => {
  cleanup();
});

describe("AuditLogTarget", () => {
  it("names the invited address and links the invitation's tenant", async () => {
    const { container } = await renderTarget(invitation);

    expect(container.textContent).toBe(
      "Admin invitation for invitee@example.comAcme Comics"
    );
    expect(
      screen.getByRole("link", { name: "Acme Comics" }).getAttribute("href")
    ).toBe("/tenants/acme");
  });

  it.each(getLocales())("shows no raw target type in %s", async (locale) => {
    const { container } = await renderTarget(invitation, locale);

    expect(container.textContent).toContain("invitee@example.com");
    expect(container.textContent).toContain("Acme Comics");
    expect(container.textContent).not.toContain("tenant_admin_invitation");
    expect(container.textContent).not.toContain(invitation.targetId);
  });

  it("names the address an entry without an invitation row files as its target", async () => {
    const { container } = await renderTarget({
      targetId: "member@example.com",
      targetType: "tenant_admin_invitation",
    });

    expect(container.textContent).toBe(
      "Admin invitation for member@example.com"
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("links the tenant of any other entry that carries one", async () => {
    await renderTarget({
      targetId: "0199a5e4-0000-7000-8000-000000000000",
      targetName: "Acme Comics",
      targetPublicId: "acme",
      targetType: "tenant",
      tenantId: "acme",
      tenantName: "Acme Comics",
    });

    expect(
      screen.getByRole("link", { name: "Acme Comics" }).getAttribute("href")
    ).toBe("/tenants/acme");
  });

  it("names a platform-wide setting", async () => {
    const { container } = await renderTarget({
      targetId: "platform",
      targetType: "smtp_config",
    });

    expect(container.textContent).toBe("SMTP settings");
  });

  it("falls back to the recorded type and ID for a target it has no name for", async () => {
    const { container } = await renderTarget({
      targetId: "42",
      targetType: "unknown_target",
    });

    expect(container.textContent).toBe("unknown_target: 42");
  });
});
