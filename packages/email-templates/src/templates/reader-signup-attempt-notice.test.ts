import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import { readerSignupAttemptNoticeDataSchema } from "./reader-signup-attempt-notice";

const data = {
  account_state: "confirmed",
  action_url: "https://tenant.example.test/reset-password",
  email: "reader@example.test",
  tenant_name: "Aoto Press",
} as const;

/** The same attempt on an account whose address is still waiting to be confirmed. */
const unconfirmedData = {
  ...data,
  account_state: "unconfirmed",
  action_url: "https://tenant.example.test/resend-verification",
} as const;

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

  it("rejects an action_url that is not an http(s) URL", () => {
    const parsed = readerSignupAttemptNoticeDataSchema.safeParse({
      ...data,
      action_url: "data:text/html,<p>reset</p>",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects an account state it has no copy for", () => {
    const parsed = readerSignupAttemptNoticeDataSchema.safeParse({
      ...data,
      account_state: "inactive",
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
    expect(result.html).toContain(data.action_url);
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
    expect(result.text).toContain("Reset password");
  });

  // A reset sets a password an unconfirmed account still cannot sign in with,
  // so the mail its owner receives has to send them somewhere else.
  it("sends an unconfirmed account to the resend page instead", async () => {
    const result = await renderEmail({
      data: unconfirmedData,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "reader_signup_attempt_notice",
      timeZone: "America/Los_Angeles",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.html).toContain(unconfirmedData.action_url);
    expect(result.text).toContain("Send a new confirmation email");
    expect(result.text).toContain("is not confirmed yet");
    expect(result.text).not.toContain("Reset password");
  });

  // The mail reports an attempt on an account it must not act on, so the only
  // link in it is a form the recipient fills in — never a link that confirms
  // the address or sets a password on its own.
  it.each([
    { data, state: "confirmed" },
    { data: unconfirmedData, state: "unconfirmed" },
  ])(
    "carries no token in the link it offers to a $state account",
    async ({ data: noticeData }) => {
      const result = await renderEmail({
        data: noticeData,
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
    }
  );
});
