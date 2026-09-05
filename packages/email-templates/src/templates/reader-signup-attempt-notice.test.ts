import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import { readerSignupAttemptNoticeDataSchema } from "./reader-signup-attempt-notice";

const data = {
  email: "reader@example.test",
  reset_url: "https://tenant.example.test/reset-password",
  tenant_name: "Aoto Press",
};

describe("readerSignupAttemptNoticeDataSchema", () => {
  it("accepts the variables the sender fills in", () => {
    expect(readerSignupAttemptNoticeDataSchema.parse(data)).toEqual(data);
  });

  it("rejects CR/LF in email", () => {
    const parsed = readerSignupAttemptNoticeDataSchema.safeParse({
      ...data,
      email: "reader@example.test\r\nBcc: injected@example.test",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a reset_url that is not an http(s) URL", () => {
    const parsed = readerSignupAttemptNoticeDataSchema.safeParse({
      ...data,
      reset_url: "data:text/html,<p>reset</p>",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("ReaderSignupAttemptNoticeEmail", () => {
  it("the ja mail names the address and offers the way back in", async () => {
    const result = await renderEmail({
      data,
      locale: "ja",
      messages: await loadEmailMessages("ja"),
      template: "reader_signup_attempt_notice",
      timeZone: "Asia/Tokyo",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.subject).toBe("Aoto Press アカウント登録の試行");
    expect(result.html).toContain(data.email);
    expect(result.html).toContain(data.reset_url);
    expect(result.text).toContain("新しいアカウントは作成されず");
    expect(result.html).toContain(data.tenant_name);
    expect(result.html).not.toContain("Publira");
  });

  it("the en mail comes from the English catalog", async () => {
    const result = await renderEmail({
      data,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "reader_signup_attempt_notice",
      timeZone: "America/Los_Angeles",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.subject).toBe("Aoto Press sign-up attempt");
    expect(result.html).toContain("A sign-up used your email address");
    expect(result.text).toContain("no second account was created");
  });

  // The mail reports an attempt on an account it must not act on, so the only
  // link in it is the reset form — never a verification link.
  it("carries no token in the link it offers", async () => {
    const result = await renderEmail({
      data,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "reader_signup_attempt_notice",
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
