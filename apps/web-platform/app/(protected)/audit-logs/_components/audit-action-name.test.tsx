import type { Locale } from "@publira/i18n";
import { isValidElement } from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MessageProps } from "#components/message";
import { getAuditActionOptions } from "#lib/audit-log-labels";

import { AuditActionName } from "./audit-action-name";

const state = vi.hoisted(() => ({ locale: "en" as Locale }));

vi.mock("#lib/locale", () => ({
  getPlatformLocale: () => Promise.resolve(state.locale),
}));

/** The text the element renders, resolving the `<Message>` it returns. */
const renderText = async (node: ReactNode): Promise<unknown> => {
  if (!isValidElement<MessageProps>(node)) {
    return node;
  }
  const render = node.type as (props: MessageProps) => Promise<string>;

  return await render(node.props);
};

describe("AuditActionName", () => {
  beforeEach(() => {
    state.locale = "en";
  });

  it.each([
    ["operator_updated", "Updated an operator"],
    ["tenant_suspended", "Suspended a tenant"],
    ["platform_email_settings_updated", "Updated SMTP settings"],
    ["platform_smtp_test_email_sent", "Sent an SMTP test email"],
    ["platform_settings_updated", "Updated platform settings"],
    ["tenant_admin_invite_canceled", "Canceled a tenant admin invitation"],
    ["tenant_admin_invite_resent", "Resent a tenant admin invitation"],
    ["tenant_admin_invited", "Invited a tenant admin"],
    ["tenant_member_added", "Added a tenant member"],
    ["tenant_member_created", "Created a tenant member account"],
    ["tenant_member_removed", "Removed a tenant member"],
    ["tenant_member_role_updated", "Changed a tenant member's role"],
  ])("names %s", async (action, name) => {
    await expect(renderText(AuditActionName({ action }))).resolves.toBe(name);
  });

  it("names every action the filter offers with the filter's label", async () => {
    const options = await getAuditActionOptions("en");
    const names = await Promise.all(
      options.map(({ value }) => renderText(AuditActionName({ action: value })))
    );

    expect(names).toEqual(options.map(({ label }) => label));
  });

  it("renders an action the console has no name for as it was recorded", async () => {
    await expect(
      renderText(AuditActionName({ action: "unknown_action" }))
    ).resolves.toBe("unknown_action");
  });

  it("says the action is unset when it is blank", async () => {
    await expect(renderText(AuditActionName({ action: " " }))).resolves.toBe(
      "Not set"
    );
  });

  it("follows the UI locale", async () => {
    state.locale = "ja";

    await expect(
      renderText(AuditActionName({ action: "tenant_member_added" }))
    ).resolves.toBe("テナントメンバーを追加");
  });
});
