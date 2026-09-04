import { describe, expect, it } from "vitest";

import { emailMessage, loadEmailMessages } from "./messages";

describe("loadEmailMessages", () => {
  it("loads only the requested locale's catalog and expands the placeholders", async () => {
    const ja = await loadEmailMessages("ja");

    expect(emailMessage(ja, "email.layout.brand")).toBe("Publira");
    expect(
      emailMessage(ja, "email.tenant_admin_invitation.subject", {
        tenant_name: "青灯書房",
      })
    ).toBe("青灯書房 管理者招待");
  });

  it("en returns the English copy for the same keys", async () => {
    const en = await loadEmailMessages("en");

    expect(
      emailMessage(en, "email.tenant_admin_invitation.subject", {
        tenant_name: "Aoto Press",
      })
    ).toBe("Aoto Press admin invitation");
    expect(
      emailMessage(en, "email.layout.footer", { brand: "Aoto Press" })
    ).toBe("This email was sent by Aoto Press.");
  });
});
