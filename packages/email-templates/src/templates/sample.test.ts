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
  it("http(s) の action_url を受け付ける", () => {
    expect(sampleEmailDataSchema.parse(sampleData)).toEqual(sampleData);
  });

  it("http(s) 以外の URL を拒否する", () => {
    const parsed = sampleEmailDataSchema.safeParse({
      ...sampleData,
      action_url: "ftp://example.com/action",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("SampleEmail", () => {
  it("件名・本文・ボタン先をレンダリングする", async () => {
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
