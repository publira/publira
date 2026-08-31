import { beforeAll, describe, expect, it } from "vitest";

import { loadEmailMessages } from "./messages";
import type { Messages } from "./messages";
import { isTemplateId, resolveEmail, TEMPLATE_IDS } from "./registry";
import { renderEmail } from "./render";

const sampleData = {
  action_label: "開く",
  action_url: "https://example.com",
  body: "本文",
  title: "件名",
};

describe("TEMPLATE_IDS", () => {
  it("holds the sample and the operational templates", () => {
    expect(TEMPLATE_IDS).toEqual(["sample", "tenant_admin_invitation"]);
    expect(isTemplateId("tenant_admin_invitation")).toBe(true);
    expect(isTemplateId("missing")).toBe(false);
  });
});

describe("resolveEmail", () => {
  let jaMessages: Messages;

  beforeAll(async () => {
    jaMessages = await loadEmailMessages("ja");
  });

  it("an unknown template becomes unknown_template", () => {
    const result = resolveEmail({
      data: {},
      locale: "ja",
      messages: jaMessages,
      template: "password_reset",
      timeZone: "Asia/Tokyo",
    });

    expect(result).toEqual({
      message: "unknown template: password_reset",
      ok: false,
      reason: "unknown_template",
    });
  });

  it("invalid data becomes invalid_data", () => {
    const result = resolveEmail({
      data: { tenant_name: "青灯書房" },
      locale: "ja",
      messages: jaMessages,
      template: "tenant_admin_invitation",
      timeZone: "Asia/Tokyo",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe("invalid_data");
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("an invalid timeZone becomes invalid_data", () => {
    const result = resolveEmail({
      data: sampleData,
      locale: "ja",
      messages: jaMessages,
      template: "sample",
      timeZone: "Local",
    });

    expect(result).toEqual({
      message: "time_zone must be an IANA time zone",
      ok: false,
      reason: "invalid_data",
    });
  });

  it("an unknown locale is normalized to ja", () => {
    const result = resolveEmail({
      data: sampleData,
      locale: "fr",
      messages: jaMessages,
      template: "sample",
      timeZone: "Asia/Tokyo",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.locale).toBe("ja");
    expect(result.timeZone).toBe("Asia/Tokyo");
    expect(result.subject).toBe("件名");
  });
});

describe("renderEmail", () => {
  it("a failure comes back without being rendered to HTML", async () => {
    const result = await renderEmail({
      data: {},
      locale: "ja",
      messages: await loadEmailMessages("ja"),
      template: "does_not_exist",
      timeZone: "Asia/Tokyo",
    });

    expect(result).toEqual({
      message: "unknown template: does_not_exist",
      ok: false,
      reason: "unknown_template",
    });
  });
});
