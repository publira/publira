import { toFormDataInput } from "@publira/utils/form-data";
import { describe, expect, it } from "vitest";

import {
  isWebPushSubject,
  webPushFormFields,
  webPushFormSchema,
} from "./form-schemas";

const parse = async (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries({ revision: "3", ...fields })) {
    data.set(name, value);
  }
  const schema = await webPushFormSchema("en");
  return schema.safeParse(toFormDataInput(data, webPushFormFields));
};

describe("isWebPushSubject", () => {
  it.each([
    "mailto:push@example.com",
    "https://example.com/contact",
    "https://example.com",
  ])("accepts %s", (subject) => {
    expect(isWebPushSubject(subject)).toBe(true);
  });

  it.each([
    "",
    "push@example.com",
    "mailto:",
    "mailto:not-an-address",
    "mailto:Push <push@example.com>",
    "http://example.com",
    "https://",
    "https://user:pass@example.com",
    "https:example.com",
    `mailto:${"a".repeat(2048)}@example.com`,
  ])("rejects %s as the server does", (subject) => {
    expect(isWebPushSubject(subject)).toBe(false);
  });
});

describe("webPushFormSchema", () => {
  it("trims the subject and reads the revision as a bigint", async () => {
    const result = await parse({ subject: "  mailto:push@example.com " });

    expect(result.data).toEqual({
      revision: 3n,
      subject: "mailto:push@example.com",
    });
  });

  it("asks for a subject when the field is empty", async () => {
    const result = await parse({ subject: "  " });

    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "Enter a contact for push services.",
    ]);
  });

  it("explains both accepted forms when the subject is neither", async () => {
    const result = await parse({ subject: "push@example.com" });

    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "Enter a mailto: URI with one email address, such as mailto:push@example.com, or an https:// URL, such as https://example.com/contact.",
    ]);
  });
});
