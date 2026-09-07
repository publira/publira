import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import { readerPasswordChangedNoticeDataSchema } from "./reader-password-changed-notice";

const data = {
  email: "reader@example.test",
  reset_url: "https://tenant.example.test/reset-password",
  tenant_name: "Aoto Press",
};

describe("readerPasswordChangedNoticeDataSchema", () => {
  it("accepts the variables the sender fills in", () => {
    expect(readerPasswordChangedNoticeDataSchema.parse(data)).toEqual(data);
  });

  it("rejects CR/LF in email", () => {
    const parsed = readerPasswordChangedNoticeDataSchema.safeParse({
      ...data,
      email: "reader@example.test\r\nBcc: injected@example.test",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a reset_url that is not an http(s) URL", () => {
    const parsed = readerPasswordChangedNoticeDataSchema.safeParse({
      ...data,
      reset_url: "data:text/html,<p>reset</p>",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("ReaderPasswordChangedNoticeEmail", () => {
  it("the ja mail reports the change and offers the way back in", async () => {
    const result = await renderEmail({
      data,
      locale: "ja",
      messages: await loadEmailMessages("ja"),
      template: "reader_password_changed_notice",
      timeZone: "Asia/Tokyo",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.subject).toBe("Aoto Press パスワード変更完了");
    expect(result.html).toContain(data.email);
    expect(result.html).toContain(data.reset_url);
    expect(result.text).toContain("アカウントのパスワードが変更されました");
    expect(result.html).toContain(data.tenant_name);
    expect(result.html).not.toContain("Publira");
  });

  it("the en mail comes from the English catalog", async () => {
    const result = await renderEmail({
      data,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "reader_password_changed_notice",
      timeZone: "America/Los_Angeles",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.subject).toBe("Aoto Press password changed");
    expect(result.html).toContain("Your password was changed");
    expect(result.text).toContain("If you did not make this change");
  });

  // Whoever made the change already knows the new password. The only link the
  // notice carries is the reset form, which is worth something to the owner of
  // the mailbox and nothing to them.
  it("carries no token in the link it offers", async () => {
    const result = await renderEmail({
      data,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "reader_password_changed_notice",
      timeZone: "Asia/Tokyo",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    for (const [link] of result.text.matchAll(/https?:\/\/\S+/gu)) {
      expect(new URL(link).searchParams.get("token")).toBeNull();
    }
  });
});
