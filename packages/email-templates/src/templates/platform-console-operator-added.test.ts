import { formatDateTime } from "@publira/utils";
import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import { platformConsoleOperatorAddedDataSchema } from "./platform-console-operator-added";

const data = {
  expires_at: "2030-01-15T12:00:00Z",
  set_password_url: "https://platform.example.test/confirm-password?token=abc",
};

describe("platformConsoleOperatorAddedDataSchema", () => {
  it("accepts the variables the sender fills in", () => {
    expect(platformConsoleOperatorAddedDataSchema.parse(data)).toEqual(data);
  });

  it("rejects a link that is not http(s)", () => {
    const parsed = platformConsoleOperatorAddedDataSchema.safeParse({
      ...data,
      set_password_url: "ftp://example.test/token",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects an expiry without a zone", () => {
    const parsed = platformConsoleOperatorAddedDataSchema.safeParse({
      ...data,
      expires_at: "2030-01-15T12:00:00",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("PlatformConsoleOperatorAddedEmail", () => {
  it("carries the link, its expiry in the given time zone, and the way back once it expires", async () => {
    const timeZone = "America/Los_Angeles";
    const result = await renderEmail({
      data,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "platform_console_operator_added",
      timeZone,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.html).toContain("Set your Platform Console password");
    expect(result.html).toContain(data.set_password_url);
    expect(result.html).toContain(
      formatDateTime(data.expires_at, { locale: "en", timeZone })
    );
    expect(result.html).toContain("Forgot your password?");
    expect(result.html).toContain("Publira");
  });
});
