import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import { staffContactReplyDataSchema } from "./staff-contact-reply";

const data = {
  body: "We have corrected the date of birth on your account.\n\nSorry for the trouble.",
  original_body:
    "The date of birth on my account is wrong.\n\nCould you correct it?",
  original_received_at: "2026-04-01T09:30:00Z",
  original_subject: "Wrong date of birth",
  tenant_name: "Aoto Press",
} as const;

describe("staffContactReplyDataSchema", () => {
  it("accepts the variables the sender fills in", () => {
    expect(staffContactReplyDataSchema.parse(data)).toEqual(data);
  });

  it("accepts an original message with no subject", () => {
    const untitled = { ...data, original_subject: "" };

    expect(staffContactReplyDataSchema.parse(untitled)).toEqual(untitled);
  });

  it("rejects an answer with no text", () => {
    const parsed = staffContactReplyDataSchema.safeParse({
      ...data,
      body: "   ",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects CR/LF in the original subject", () => {
    const parsed = staffContactReplyDataSchema.safeParse({
      ...data,
      original_subject: "Wrong date of birth\r\nX-Injected: 1",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects an original time that is not a timestamp", () => {
    const parsed = staffContactReplyDataSchema.safeParse({
      ...data,
      original_received_at: "the first of April",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("StaffContactReplyEmail", () => {
  it("the en mail carries the answer with the reader's message quoted under it", async () => {
    const result = await renderEmail({
      data,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "staff_contact_reply",
      timeZone: "UTC",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const answer = result.html.indexOf("Sorry for the trouble.");
    const quoted = result.html.indexOf("Could you correct it?");
    expect(answer).toBeGreaterThan(-1);
    expect(quoted).toBeGreaterThan(answer);
    expect(result.html).toContain("you wrote:");
    expect(result.html).toContain("To answer, reply to this email.");
    expect(result.html).toContain(data.tenant_name);
    expect(result.html).not.toContain("Publira");
  });

  // The reader answers by replying to the mail, so it sends them nowhere.
  it("offers no link at all", async () => {
    const result = await renderEmail({
      data,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "staff_contact_reply",
      timeZone: "UTC",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect([...result.html.matchAll(/href="/gu)]).toHaveLength(0);
  });

  it("the ja mail comes from the Japanese catalog", async () => {
    const result = await renderEmail({
      data,
      locale: "ja",
      messages: await loadEmailMessages("ja"),
      template: "staff_contact_reply",
      timeZone: "UTC",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.html).toContain("お送りいただいた内容");
    expect(result.html).toContain("Could you correct it?");
  });
});
