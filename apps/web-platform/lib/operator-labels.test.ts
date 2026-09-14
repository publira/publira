import { describe, expect, it } from "vitest";

import {
  getOperatorRoleCardDescription,
  getOperatorRoleLabel,
  getOperatorRoleSelectItems,
  getOperatorStatusLabel,
} from "./operator-labels";

const en = "en" as const;

describe("platform-operator-labels", () => {
  describe("getOperatorRoleLabel", () => {
    it("should return the label for platform_super_admin", async () => {
      await expect(
        getOperatorRoleLabel("platform_super_admin", en)
      ).resolves.toBe("Super admin");
    });

    it("should return the label for platform_operator", async () => {
      await expect(getOperatorRoleLabel("platform_operator", en)).resolves.toBe(
        "Operator"
      );
    });

    it("should return the label for platform_auditor", async () => {
      await expect(getOperatorRoleLabel("platform_auditor", en)).resolves.toBe(
        "Auditor"
      );
    });

    it("should return original role for unknown role", async () => {
      await expect(getOperatorRoleLabel("unknown_role", en)).resolves.toBe(
        "unknown_role"
      );
    });
  });

  describe("getOperatorStatusLabel", () => {
    it("should return the label for active", async () => {
      await expect(getOperatorStatusLabel("active", en)).resolves.toBe(
        "Active"
      );
    });

    it("should return the label for inactive", async () => {
      await expect(getOperatorStatusLabel("inactive", en)).resolves.toBe(
        "Inactive"
      );
    });

    it("should return the label for suspended", async () => {
      await expect(getOperatorStatusLabel("suspended", en)).resolves.toBe(
        "Suspended"
      );
    });

    it("should return original status for unknown status", async () => {
      await expect(getOperatorStatusLabel("unknown_status", en)).resolves.toBe(
        "unknown_status"
      );
    });
  });

  describe("getOperatorRoleSelectItems", () => {
    it("should return labels in super-admin / operator / auditor order", async () => {
      await expect(getOperatorRoleSelectItems(en)).resolves.toEqual([
        { label: "Super admin", value: "platform_super_admin" },
        { label: "Operator", value: "platform_operator" },
        { label: "Auditor", value: "platform_auditor" },
      ]);
    });
  });

  describe("getOperatorRoleCardDescription", () => {
    it("should return self message when isSelf is true", async () => {
      await expect(
        getOperatorRoleCardDescription({ isSelf: true, isSuperAdmin: true }, en)
      ).resolves.toBe("You cannot change your own role.");
    });

    it("should return permission denied message when not super admin", async () => {
      await expect(
        getOperatorRoleCardDescription(
          { isSelf: false, isSuperAdmin: false },
          en
        )
      ).resolves.toBe("Only a super admin can change roles.");
    });

    it("should return success message when can modify", async () => {
      await expect(
        getOperatorRoleCardDescription(
          { isSelf: false, isSuperAdmin: true },
          en
        )
      ).resolves.toBe("Change this operator's role.");
    });
  });
});
