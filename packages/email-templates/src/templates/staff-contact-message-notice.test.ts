import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import { staffContactMessageNoticeDataSchema } from "./staff-contact-message-notice";

const data = {
  body: "The date of birth on my account is wrong.\n\nCould you correct it?",
  received_at: "2026-04-01T09:30:00Z",
  reply_to_email: "reader@example.test",
  sender_name: "Rin Amagai",
  subject: "Wrong date of birth",
  tenant_name: "Aoto Press",
} as const;

/** The same message from somebody who is not signed in and gave no subject. */
const guestData = {
  ...data,
  sender_name: "",
  subject: "",
} as const;

describe("staffContactMessageNoticeDataSchema", () => {
  it("accepts the variables the sender fills in", () => {
    expect(staffContactMessageNoticeDataSchema.parse(data)).toEqual(data);
  });

  it("accepts an empty sender and subject", () => {
    expect(staffContactMessageNoticeDataSchema.parse(guestData)).toEqual(
      guestData
    );
  });

  it("rejects CR/LF in reply_to_email", () => {
    const parsed = staffContactMessageNoticeDataSchema.safeParse({
      ...data,
      reply_to_email: "reader@example.test\r\nBcc: injected@example.test",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects CR/LF in subject", () => {
    const parsed = staffContactMessageNoticeDataSchema.safeParse({
      ...data,
      subject: "Wrong date of birth\r\nX-Injected: 1",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a message with no body", () => {
    const parsed = staffContactMessageNoticeDataSchema.safeParse({
      ...data,
      body: "   ",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("StaffContactMessageNoticeEmail", () => {
  it("the en mail carries the message, the address to answer at, and the sender", async () => {
    const result = await renderEmail({
      data,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "staff_contact_message_notice",
      timeZone: "UTC",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.html).toContain("New contact message");
    expect(result.html).toContain(data.reply_to_email);
    expect(result.html).toContain(data.sender_name);
    expect(result.html).toContain(data.subject);
    expect(result.html).toContain("Could you correct it?");
    expect(result.html).toContain(data.tenant_name);
    expect(result.html).not.toContain("Publira");
  });

  // The whole message is in the mail, so nothing here may send staff somewhere
  // to read it: the console screen that would answer such a link is not built
  // yet, and staff answer from their mail client either way.
  it("offers no link at all", async () => {
    const result = await renderEmail({
      data,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "staff_contact_message_notice",
      timeZone: "UTC",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect([...result.html.matchAll(/href="/gu)]).toHaveLength(0);
  });

  it("leaves out the sender and subject lines a guest gave none of", async () => {
    const result = await renderEmail({
      data: guestData,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "staff_contact_message_notice",
      timeZone: "UTC",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.html).toContain(guestData.reply_to_email);
    expect(result.html).not.toContain("Signed in as");
    expect(result.html).not.toContain("Subject:");
  });

  it("the ja mail comes from the Japanese catalog", async () => {
    const result = await renderEmail({
      data,
      locale: "ja",
      messages: await loadEmailMessages("ja"),
      template: "staff_contact_message_notice",
      timeZone: "UTC",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.html).toContain("お問い合わせが届きました");
    expect(result.html).toContain(data.reply_to_email);
  });
});
