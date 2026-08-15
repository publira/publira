import { describe, expect, it } from "vitest";

import { isTemplateId, resolveEmail, TEMPLATE_IDS } from "./registry";
import { renderEmail } from "./render";

describe("TEMPLATE_IDS", () => {
  it("サンプルと業務テンプレートを含む", () => {
    expect(TEMPLATE_IDS).toEqual(["sample", "tenant_admin_invitation"]);
    expect(isTemplateId("tenant_admin_invitation")).toBe(true);
    expect(isTemplateId("missing")).toBe(false);
  });
});

describe("resolveEmail", () => {
  it("未知の template を unknown_template にする", () => {
    const result = resolveEmail({
      data: {},
      template: "password_reset",
    });

    expect(result).toEqual({
      message: "unknown template: password_reset",
      ok: false,
      reason: "unknown_template",
    });
  });

  it("不正な data を invalid_data にする", () => {
    const result = resolveEmail({
      data: { tenant_name: "青灯書房" },
      template: "tenant_admin_invitation",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe("invalid_data");
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("未知の locale は ja に正規化する", () => {
    const result = resolveEmail({
      data: {
        action_label: "開く",
        action_url: "https://example.com",
        body: "本文",
        title: "件名",
      },
      locale: "fr",
      template: "sample",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.locale).toBe("ja");
    expect(result.subject).toBe("件名");
  });
});

describe("renderEmail", () => {
  it("失敗を HTML 化せずに返す", async () => {
    const result = await renderEmail({
      data: {},
      template: "does_not_exist",
    });

    expect(result).toEqual({
      message: "unknown template: does_not_exist",
      ok: false,
      reason: "unknown_template",
    });
  });
});
