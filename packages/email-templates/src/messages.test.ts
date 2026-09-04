import { describe, expect, it } from "vitest";

import { emailMessage, loadEmailMessages } from "./messages";

describe("loadEmailMessages", () => {
  it("loads only the requested locale's catalog and expands the placeholders", async () => {
    const en = await loadEmailMessages("en");

    expect(emailMessage(en, "email.layout.brand")).toBe("Publira");
    expect(
      emailMessage(en, "email.tenant_admin_invitation.subject", {
        tenant_name: "Aoto Press",
      })
    ).toBe("Aoto Press admin invitation");
    expect(
      emailMessage(en, "email.layout.footer", { brand: "Aoto Press" })
    ).toBe("This email was sent by Aoto Press.");
  });

  it("ja returns the Japanese copy for the same keys", async () => {
    const ja = await loadEmailMessages("ja");

    expect(emailMessage(ja, "email.layout.brand")).toBe("Publira");
    expect(
      emailMessage(ja, "email.tenant_admin_invitation.subject", {
        tenant_name: "Aoto Press",
      })
    ).toBe("Aoto Press 管理者招待");
  });
});
