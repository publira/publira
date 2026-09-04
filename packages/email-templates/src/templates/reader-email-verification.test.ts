import { formatDateTime } from "@publira/utils";
import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import { readerEmailVerificationDataSchema } from "./reader-email-verification";

const data = {
  expires_at: "2030-01-15T12:00:00Z",
  tenant_name: "青灯書房",
  verify_url: "https://reader.example.test/verify?token=abc",
};

describe("readerEmailVerificationDataSchema", () => {
  it("accepts the variables the sender fills in", () => {
    expect(readerEmailVerificationDataSchema.parse(data)).toEqual(data);
  });

  it("rejects a link that is not http(s)", () => {
    const parsed = readerEmailVerificationDataSchema.safeParse({
      ...data,
      verify_url: "ftp://example.test/token",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects an expiry without a zone", () => {
    const parsed = readerEmailVerificationDataSchema.safeParse({
      ...data,
      expires_at: "2030-01-15T12:00:00",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects an empty tenant_name", () => {
    const parsed = readerEmailVerificationDataSchema.safeParse({
      ...data,
      tenant_name: "   ",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("ReaderEmailVerificationEmail", () => {
  it("the ja mail carries the link and the expiry in the given time zone", async () => {
    const timeZone = "Asia/Tokyo";
    const result = await renderEmail({
      data,
      locale: "ja",
      messages: await loadEmailMessages("ja"),
      template: "reader_email_verification",
      timeZone,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.subject).toBe("青灯書房 メールアドレス確認");
    expect(result.html).toContain("メールアドレスの確認");
    expect(result.html).toContain(data.verify_url);
    expect(result.html).toContain(
      formatDateTime(data.expires_at, { locale: "ja", timeZone })
    );
    expect(result.text).toContain("心当たりがない場合");
    expect(result.html).toContain(data.tenant_name);
    expect(result.html).not.toContain("Publira");
  });

  it("the en mail comes from the English catalog and its own time zone", async () => {
    const timeZone = "America/Los_Angeles";
    const result = await renderEmail({
      data,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "reader_email_verification",
      timeZone,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const expires = formatDateTime(data.expires_at, { locale: "en", timeZone });

    expect(result.subject).toBe("青灯書房 email address verification");
    expect(result.html).toContain("Verify your email address");
    expect(result.html).toContain(expires);
    expect(expires).not.toBe(
      formatDateTime(data.expires_at, { locale: "en", timeZone: "Asia/Tokyo" })
    );
  });
});
