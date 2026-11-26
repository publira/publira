import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import { adminConsoleMfaChangedNoticeDataSchema } from "./admin-console-mfa-changed-notice";

const data = {
  change: "passkey_registered",
  changed_at: "2030-01-15T12:00:00Z",
  tenant_name: "Aoto Press",
};

describe("adminConsoleMfaChangedNoticeDataSchema", () => {
  it("accepts the variables the sender fills in", () => {
    expect(adminConsoleMfaChangedNoticeDataSchema.parse(data)).toEqual(data);
  });

  it("rejects a change the console cannot make", () => {
    const parsed = adminConsoleMfaChangedNoticeDataSchema.safeParse({
      ...data,
      change: "passkey_renamed",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a changed_at that is not a timestamp", () => {
    const parsed = adminConsoleMfaChangedNoticeDataSchema.safeParse({
      ...data,
      changed_at: "yesterday",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("AdminConsoleMfaChangedNoticeEmail", () => {
  it("names the change and when it was made, in the time zone given", async () => {
    const result = await renderEmail({
      data,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "admin_console_mfa_changed_notice",
      timeZone: "America/Los_Angeles",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.html).toContain(
      "Your admin console two-step verification was changed"
    );
    expect(result.html).toContain(
      "A passkey was added to your admin console account."
    );
    expect(result.html).toContain("Jan 15, 2030, 4:00");
    expect(result.html).toContain("If you did not make this change");
    expect(result.html).toContain(data.tenant_name);
    expect(result.html).not.toContain("Publira");
  });

  it.each([
    ["totp_enabled", "An authenticator app was set up"],
    ["totp_disabled", "The authenticator app on your admin console account"],
    ["passkey_removed", "A passkey was removed"],
    ["recovery_codes_regenerated", "The previous codes no longer work."],
  ])("words the %s change", async (change, copy) => {
    const result = await renderEmail({
      data: { ...data, change },
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "admin_console_mfa_changed_notice",
      timeZone: "UTC",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.html).toContain(copy);
  });
});
