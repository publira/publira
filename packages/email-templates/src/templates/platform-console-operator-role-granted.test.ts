import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import { platformConsoleOperatorRoleGrantedDataSchema } from "./platform-console-operator-role-granted";

const data = {
  sign_in_url: "https://platform.example.test/login",
};

describe("platformConsoleOperatorRoleGrantedDataSchema", () => {
  it("accepts the variables the sender fills in", () => {
    expect(platformConsoleOperatorRoleGrantedDataSchema.parse(data)).toEqual(
      data
    );
  });

  it("rejects a link that is not http(s)", () => {
    const parsed = platformConsoleOperatorRoleGrantedDataSchema.safeParse({
      sign_in_url: "ftp://platform.example.test/login",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("PlatformConsoleOperatorRoleGrantedEmail", () => {
  it("links to the sign-in screen", async () => {
    const result = await renderEmail({
      data,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "platform_console_operator_role_granted",
      timeZone: "UTC",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.html).toContain(
      "You can now sign in to the Platform Console"
    );
    expect(result.html).toContain(data.sign_in_url);
  });
});
