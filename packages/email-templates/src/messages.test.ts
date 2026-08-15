import { describe, expect, it } from "vitest";

import { emailMessage, loadEmailMessages } from "./messages";

describe("loadEmailMessages", () => {
  it("指定したロケールのカタログだけを読み、プレースホルダを展開する", async () => {
    const ja = await loadEmailMessages("ja");

    expect(emailMessage(ja, "email.layout.brand")).toBe("Publira");
    expect(
      emailMessage(ja, "email.tenant_admin_invitation.subject", {
        tenant_name: "青灯書房",
      })
    ).toBe("青灯書房 管理者招待");
  });

  it("未知のロケールは ja にフォールバックする", async () => {
    const catalog = await loadEmailMessages("fr");

    expect(emailMessage(catalog, "email.tenant_admin_invitation.action")).toBe(
      "招待を承諾する"
    );
  });

  it("en は同じキーで英語の文面を返す", async () => {
    const en = await loadEmailMessages("en");

    expect(
      emailMessage(en, "email.tenant_admin_invitation.subject", {
        tenant_name: "Aoto Press",
      })
    ).toBe("Aoto Press admin invitation");
    expect(emailMessage(en, "email.layout.footer")).toBe(
      "This email was sent by Publira."
    );
  });
});
