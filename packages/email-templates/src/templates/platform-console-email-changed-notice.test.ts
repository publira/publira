import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import { platformConsoleEmailChangedNoticeDataSchema } from "./platform-console-email-changed-notice";

const data = {
  new_email: "new-owner@example.test",
  previous_email: "owner@example.test",
};

describe("platformConsoleEmailChangedNoticeDataSchema", () => {
  it("accepts the variables the sender fills in", () => {
    expect(platformConsoleEmailChangedNoticeDataSchema.parse(data)).toEqual(
      data
    );
  });

  it("rejects CR/LF in new_email", () => {
    const parsed = platformConsoleEmailChangedNoticeDataSchema.safeParse({
      ...data,
      new_email: "new-owner@example.test\r\nBcc: injected@example.test",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("PlatformConsoleEmailChangedNoticeEmail", () => {
  it("the ja mail names both addresses and warns about an unexpected change", async () => {
    const result = await renderEmail({
      data,
      locale: "ja",
      messages: await loadEmailMessages("ja"),
      template: "platform_console_email_changed_notice",
      timeZone: "Asia/Tokyo",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.subject).toBe(
      "Publira Platform Console メールアドレス変更完了"
    );
    expect(result.html).toContain("Platform Console メールアドレス変更の完了");
    expect(result.html).toContain(data.previous_email);
    expect(result.html).toContain(data.new_email);
    expect(result.text).toContain("この変更に心当たりがない場合");
  });

  it("the en mail comes from the English catalog", async () => {
    const result = await renderEmail({
      data,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "platform_console_email_changed_notice",
      timeZone: "America/Los_Angeles",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.subject).toBe(
      "Publira Platform Console email address changed"
    );
    expect(result.html).toContain(
      "Your Platform Console email address was changed"
    );
    expect(result.text).toContain("If you did not make this change");
  });
});
