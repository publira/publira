import type { ExactCatalog } from "@publira/utils/i18n";
import { describe, expect, it } from "vitest";

import { emailMessage } from "./messages";
import en from "./messages/en.json";
import type ja from "./messages/ja.json";

/** Compile-time: en.json must match ja.json with no extra keys. */
const enMatchesJa: ExactCatalog<typeof en, typeof ja> = en;

describe("emailMessage", () => {
  it("ja を正本としてプレースホルダを展開する", () => {
    expect(enMatchesJa.layout.brand).toBe("Publira");
    expect(
      emailMessage("ja", "tenant_admin_invitation.subject", {
        tenant_name: "青灯書房",
      })
    ).toBe("青灯書房 管理者招待");
  });

  it("未知のロケールは ja にフォールバックする", () => {
    expect(emailMessage("fr", "tenant_admin_invitation.action")).toBe(
      "招待を承諾する"
    );
  });

  it("en は同じキーで英語の文面を返す", () => {
    expect(
      emailMessage("en", "tenant_admin_invitation.subject", {
        tenant_name: "Aoto Press",
      })
    ).toBe("Aoto Press admin invitation");
    expect(emailMessage("en", "layout.footer")).toBe(
      "This email was sent by Publira."
    );
  });
});
