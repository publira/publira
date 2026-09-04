import { formatDateTime } from "@publira/utils";
import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import {
  tenantAdminInvitationDataSchema,
  tenantAdminInvitationSubject,
} from "./tenant-admin-invitation";

const invitationData = {
  expires_at: "2030-01-15T12:00:00Z",
  invite_url: "https://admin.example.com/accept-invite?token=abc",
  tenant_name: "青灯書房",
};

describe("tenantAdminInvitationDataSchema", () => {
  it("accepts the three variables the design calls for", () => {
    expect(tenantAdminInvitationDataSchema.parse(invitationData)).toEqual(
      invitationData
    );
  });

  it("rejects a date and time without a zone", () => {
    const parsed = tenantAdminInvitationDataSchema.safeParse({
      ...invitationData,
      expires_at: "2030-01-15T12:00:00",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects an empty tenant_name", () => {
    const parsed = tenantAdminInvitationDataSchema.safeParse({
      ...invitationData,
      tenant_name: "   ",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects CR/LF in tenant_name", () => {
    const parsed = tenantAdminInvitationDataSchema.safeParse({
      ...invitationData,
      tenant_name: "青灯書房\r\nBcc: injected@example.com",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("TenantAdminInvitationEmail", () => {
  it("the ja subject and body carry the tenant name and the invitation URL", async () => {
    const timeZone = "Asia/Tokyo";
    const result = await renderEmail({
      data: invitationData,
      locale: "ja",
      messages: await loadEmailMessages("ja"),
      template: "tenant_admin_invitation",
      timeZone,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const expires = formatDateTime(invitationData.expires_at, {
      locale: "ja",
      timeZone,
    });

    expect(result.subject).toBe("青灯書房 管理者招待");
    expect(result.html).toContain("青灯書房 の管理画面へ招待されました。");
    expect(result.html).not.toContain("Publira");
    expect(result.html).not.toContain("招待を受け付けました");
    expect(result.html).toContain("招待を承諾する");
    expect(result.html).toContain(invitationData.invite_url);
    expect(result.html).toContain(expires);
    expect(result.text).toContain("心当たりがない場合");
  });

  it("expires_at is shown in the given timeZone", async () => {
    const timeZone = "America/Los_Angeles";
    const result = await renderEmail({
      data: invitationData,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "tenant_admin_invitation",
      timeZone,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const expires = formatDateTime(invitationData.expires_at, {
      locale: "en",
      timeZone,
    });
    const tokyo = formatDateTime(invitationData.expires_at, {
      locale: "en",
      timeZone: "Asia/Tokyo",
    });

    expect(result.html).toContain(expires);
    expect(expires).not.toBe(tokyo);
  });

  it("en produces an English subject", async () => {
    const messages = await loadEmailMessages("en");

    expect(tenantAdminInvitationSubject(invitationData, messages)).toBe(
      "青灯書房 admin invitation"
    );
  });
});
