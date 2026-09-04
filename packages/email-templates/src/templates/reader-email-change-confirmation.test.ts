import { formatDateTime } from "@publira/utils";
import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import { readerEmailChangeConfirmationDataSchema } from "./reader-email-change-confirmation";

const data = {
  confirm_url: "https://reader.example.test/confirm-email?token=abc",
  current_email: "owner@example.test",
  expires_at: "2030-01-15T12:00:00Z",
  new_email: "new-owner@example.test",
  recipient_kind: "current_email",
  tenant_name: "Aoto Press",
};
const currentAddressBody =
  "This change needs confirmation from your current address.";
const newAddressBody = "This change needs confirmation from your new address.";

describe("readerEmailChangeConfirmationDataSchema", () => {
  it("accepts the variables the sender fills in", () => {
    expect(readerEmailChangeConfirmationDataSchema.parse(data)).toEqual(data);
  });

  it("rejects a link that is not http(s)", () => {
    const parsed = readerEmailChangeConfirmationDataSchema.safeParse({
      ...data,
      confirm_url: "ftp://example.test/token",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects an expiry without a zone", () => {
    const parsed = readerEmailChangeConfirmationDataSchema.safeParse({
      ...data,
      expires_at: "2030-01-15T12:00:00",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects CR/LF in new_email", () => {
    const parsed = readerEmailChangeConfirmationDataSchema.safeParse({
      ...data,
      new_email: "new-owner@example.test\r\nBcc: injected@example.test",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a recipient_kind that is neither side of the change", () => {
    const parsed = readerEmailChangeConfirmationDataSchema.safeParse({
      ...data,
      recipient_kind: "both",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects an empty tenant_name", () => {
    const parsed = readerEmailChangeConfirmationDataSchema.safeParse({
      ...data,
      tenant_name: "   ",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("ReaderEmailChangeConfirmationEmail", () => {
  it("the ja mail carries the link and the expiry in the given time zone", async () => {
    const timeZone = "Asia/Tokyo";
    const result = await renderEmail({
      data,
      locale: "ja",
      messages: await loadEmailMessages("ja"),
      template: "reader_email_change_confirmation",
      timeZone,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.subject).toBe("Aoto Press メールアドレス変更確認");
    expect(result.html).toContain("メールアドレス変更の確認");
    expect(result.html).toContain(data.confirm_url);
    expect(result.html).toContain(
      formatDateTime(data.expires_at, { locale: "ja", timeZone })
    );
    expect(result.html).toContain(data.current_email);
    expect(result.html).toContain(data.new_email);
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
      template: "reader_email_change_confirmation",
      timeZone,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const expires = formatDateTime(data.expires_at, { locale: "en", timeZone });

    expect(result.subject).toBe("Aoto Press email address change confirmation");
    expect(result.html).toContain("Confirm your email address change");
    expect(result.html).toContain(expires);
    expect(expires).not.toBe(
      formatDateTime(data.expires_at, { locale: "en", timeZone: "Asia/Tokyo" })
    );
  });

  it("addresses the side of the change the sender names", async () => {
    const messages = await loadEmailMessages("en");
    const toCurrent = await renderEmail({
      data,
      locale: "en",
      messages,
      template: "reader_email_change_confirmation",
      timeZone: "Asia/Tokyo",
    });
    const toNew = await renderEmail({
      data: { ...data, recipient_kind: "new_email" },
      locale: "en",
      messages,
      template: "reader_email_change_confirmation",
      timeZone: "Asia/Tokyo",
    });

    expect(toCurrent.ok).toBe(true);
    expect(toNew.ok).toBe(true);
    if (!(toCurrent.ok && toNew.ok)) {
      return;
    }

    expect(toCurrent.text).toContain(currentAddressBody);
    expect(toCurrent.text).not.toContain(newAddressBody);
    expect(toNew.text).toContain(newAddressBody);
    expect(toNew.text).not.toContain(currentAddressBody);
  });
});
