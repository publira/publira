import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import { adminConsoleEmailChangedNoticeDataSchema } from "./admin-console-email-changed-notice";

const data = {
  new_email: "new-owner@example.test",
  previous_email: "owner@example.test",
  tenant_name: "青灯書房",
};

describe("adminConsoleEmailChangedNoticeDataSchema", () => {
  it("accepts the variables the sender fills in", () => {
    expect(adminConsoleEmailChangedNoticeDataSchema.parse(data)).toEqual(data);
  });

  it("rejects CR/LF in new_email", () => {
    const parsed = adminConsoleEmailChangedNoticeDataSchema.safeParse({
      ...data,
      new_email: "new-owner@example.test\r\nBcc: injected@example.test",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects an empty tenant_name", () => {
    const parsed = adminConsoleEmailChangedNoticeDataSchema.safeParse({
      ...data,
      tenant_name: "   ",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("AdminConsoleEmailChangedNoticeEmail", () => {
  it("the ja mail names both addresses and warns about an unexpected change", async () => {
    const result = await renderEmail({
      data,
      locale: "ja",
      messages: await loadEmailMessages("ja"),
      template: "admin_console_email_changed_notice",
      timeZone: "Asia/Tokyo",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.subject).toBe("青灯書房 管理画面メールアドレス変更完了");
    expect(result.html).toContain("管理画面メールアドレス変更の完了");
    expect(result.html).toContain(data.previous_email);
    expect(result.html).toContain(data.new_email);
    expect(result.text).toContain("この変更に心当たりがない場合");
  });

  it("the en mail comes from the English catalog", async () => {
    const result = await renderEmail({
      data,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "admin_console_email_changed_notice",
      timeZone: "America/Los_Angeles",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.subject).toBe("青灯書房 admin console email address changed");
    expect(result.html).toContain(
      "Your admin console email address was changed"
    );
    expect(result.text).toContain("If you did not make this change");
  });
});
