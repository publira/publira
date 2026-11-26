import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import { platformConsoleMfaChangedNoticeDataSchema } from "./platform-console-mfa-changed-notice";

const data = {
  change: "totp_disabled",
  changed_at: "2030-01-15T12:00:00Z",
};

describe("platformConsoleMfaChangedNoticeDataSchema", () => {
  it("accepts the variables the sender fills in", () => {
    expect(platformConsoleMfaChangedNoticeDataSchema.parse(data)).toEqual(data);
  });

  it("rejects a passkey change, which an operator cannot make", () => {
    const parsed = platformConsoleMfaChangedNoticeDataSchema.safeParse({
      ...data,
      change: "passkey_registered",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("PlatformConsoleMfaChangedNoticeEmail", () => {
  it("is branded with the platform and names the change", async () => {
    const result = await renderEmail({
      data,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "platform_console_mfa_changed_notice",
      timeZone: "UTC",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.html).toContain("Publira");
    expect(result.html).toContain(
      "The authenticator app on your Platform Console account was turned off."
    );
    expect(result.html).toContain("Jan 15, 2030, 12:00");
    expect(result.html).toContain("If you did not make this change");
  });
});
