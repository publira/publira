import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import { readerSignInMethodChangedNoticeDataSchema } from "./reader-sign-in-method-changed-notice";

const data = {
  change: "passkey_added",
  email: "reader@example.test",
  provider_name: "",
  settings_url: "https://tenant.example.test/settings/security",
  tenant_name: "Aoto Press",
} as const;

const render = async (overrides: Partial<Record<keyof typeof data, string>>) =>
  renderEmail({
    data: { ...data, ...overrides },
    locale: "en",
    messages: await loadEmailMessages("en"),
    template: "reader_sign_in_method_changed_notice",
    timeZone: "UTC",
  });

describe("readerSignInMethodChangedNoticeDataSchema", () => {
  it("accepts the variables the sender fills in", () => {
    expect(readerSignInMethodChangedNoticeDataSchema.parse(data)).toEqual(data);
  });

  it("rejects a change it has no copy for", () => {
    const parsed = readerSignInMethodChangedNoticeDataSchema.safeParse({
      ...data,
      change: "password_removed",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects CR/LF in provider_name", () => {
    const parsed = readerSignInMethodChangedNoticeDataSchema.safeParse({
      ...data,
      change: "identity_unlinked",
      provider_name: "Google\r\nBcc: injected@example.test",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a settings_url that is not an http(s) URL", () => {
    const parsed = readerSignInMethodChangedNoticeDataSchema.safeParse({
      ...data,
      settings_url: "ftp://tenant.example.test/settings/security",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("ReaderSignInMethodChangedNoticeEmail", () => {
  it("reports a passkey added, with the address and the security settings", async () => {
    const result = await render({});

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.html).toContain("A passkey was added");
    expect(result.html).toContain(data.email);
    expect(result.html).toContain(data.settings_url);
    expect(result.html).toContain("If you did not make this change");
    expect(result.html).toContain(data.tenant_name);
  });

  it("reports a passkey removed", async () => {
    const result = await render({ change: "passkey_removed" });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.html).toContain("A passkey was removed");
    expect(result.html).not.toContain("A passkey was added");
  });

  it("names the provider that was unlinked", async () => {
    const result = await render({
      change: "identity_unlinked",
      provider_name: "Google",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.html).toContain("Your Google account was unlinked");
  });
});
