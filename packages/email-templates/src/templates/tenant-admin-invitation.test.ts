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
  it("設計どおりの 3 変数を受け付ける", () => {
    expect(tenantAdminInvitationDataSchema.parse(invitationData)).toEqual(
      invitationData
    );
  });

  it("ゾーンなしの日時を拒否する", () => {
    const parsed = tenantAdminInvitationDataSchema.safeParse({
      ...invitationData,
      expires_at: "2030-01-15T12:00:00",
    });

    expect(parsed.success).toBe(false);
  });

  it("空の tenant_name を拒否する", () => {
    const parsed = tenantAdminInvitationDataSchema.safeParse({
      ...invitationData,
      tenant_name: "   ",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("TenantAdminInvitationEmail", () => {
  it("ja の件名と本文にテナント名と招待 URL を含める", async () => {
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
    expect(result.html).toContain("招待を承諾する");
    expect(result.html).toContain(invitationData.invite_url);
    expect(result.html).toContain(expires);
    expect(result.text).toContain("心当たりがない場合");
  });

  it("expires_at を渡された timeZone で表示する", async () => {
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

  it("en では英語の件名になる", async () => {
    const messages = await loadEmailMessages("en");

    expect(tenantAdminInvitationSubject(invitationData, messages)).toBe(
      "青灯書房 admin invitation"
    );
  });
});
