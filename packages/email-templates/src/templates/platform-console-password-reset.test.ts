import { formatDateTime } from "@publira/utils";
import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import { platformConsolePasswordResetDataSchema } from "./platform-console-password-reset";

const data = {
  expires_at: "2030-01-15T12:00:00Z",
  reset_url: "https://platform.example.test/confirm-password?token=abc",
};

describe("platformConsolePasswordResetDataSchema", () => {
  it("accepts the variables the sender fills in", () => {
    expect(platformConsolePasswordResetDataSchema.parse(data)).toEqual(data);
  });

  it("rejects a link that is not http(s)", () => {
    const parsed = platformConsolePasswordResetDataSchema.safeParse({
      ...data,
      reset_url: "ftp://example.test/token",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects an expiry without a zone", () => {
    const parsed = platformConsolePasswordResetDataSchema.safeParse({
      ...data,
      expires_at: "2030-01-15T12:00:00",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("PlatformConsolePasswordResetEmail", () => {
  it("the ja mail carries the link and the expiry in the given time zone", async () => {
    const timeZone = "Asia/Tokyo";
    const result = await renderEmail({
      data,
      locale: "ja",
      messages: await loadEmailMessages("ja"),
      template: "platform_console_password_reset",
      timeZone,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.subject).toBe("Publira Platform Console パスワード再設定");
    expect(result.html).toContain("Platform Console パスワードの再設定");
    expect(result.html).toContain(data.reset_url);
    expect(result.html).toContain(
      formatDateTime(data.expires_at, { locale: "ja", timeZone })
    );
    expect(result.text).toContain("心当たりがない場合");
  });

  it("the en mail comes from the English catalog and its own time zone", async () => {
    const timeZone = "America/Los_Angeles";
    const result = await renderEmail({
      data,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "platform_console_password_reset",
      timeZone,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const expires = formatDateTime(data.expires_at, { locale: "en", timeZone });

    expect(result.subject).toBe("Publira Platform Console password reset");
    expect(result.html).toContain("Reset your Platform Console password");
    expect(result.html).toContain(expires);
    expect(expires).not.toBe(
      formatDateTime(data.expires_at, { locale: "en", timeZone: "Asia/Tokyo" })
    );
  });
});
