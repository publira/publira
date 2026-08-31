import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import { sampleEmailDataSchema } from "./sample";

const sampleData = {
  action_label: "Open",
  action_url: "https://example.com/action",
  body: "This is a sample body.",
  title: "Sample email",
};

describe("sampleEmailDataSchema", () => {
  it("accepts an http(s) action_url", () => {
    expect(sampleEmailDataSchema.parse(sampleData)).toEqual(sampleData);
  });

  it("rejects CR/LF in title", () => {
    const parsed = sampleEmailDataSchema.safeParse({
      ...sampleData,
      title: "Sample\r\nBcc: injected@example.com",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a URL that is not http(s)", () => {
    const parsed = sampleEmailDataSchema.safeParse({
      ...sampleData,
      action_url: "ftp://example.com/action",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("SampleEmail", () => {
  it("renders the subject, the body, and the button target", async () => {
    const result = await renderEmail({
      data: sampleData,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "sample",
      timeZone: "America/Los_Angeles",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.subject).toBe("Sample email");
    expect(result.timeZone).toBe("America/Los_Angeles");
    expect(result.html).toContain("This is a sample body.");
    expect(result.html).toContain('href="https://example.com/action"');
    expect(result.text).toContain("Open");
    expect(result.html).toContain("This email was sent by Publira.");
  });
});
