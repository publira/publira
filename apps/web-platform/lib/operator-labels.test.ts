import { describe, expect, it } from "vitest";

import { loadPlatformMessages } from "./locale";
import {
  getOperatorRoleCardDescription,
  getOperatorRoleLabel,
  getOperatorRoleSelectItems,
  getOperatorStatusLabel,
} from "./operator-labels";

const en = await loadPlatformMessages("en");

describe("platform-operator-labels", () => {
  describe("getOperatorRoleLabel", () => {
    it("should return the label for platform_super_admin", () => {
      expect(getOperatorRoleLabel("platform_super_admin", en)).toBe(
        "Super admin"
      );
    });

    it("should return the label for platform_operator", () => {
      expect(getOperatorRoleLabel("platform_operator", en)).toBe("Operator");
    });

    it("should return the label for platform_auditor", () => {
      expect(getOperatorRoleLabel("platform_auditor", en)).toBe("Auditor");
    });

    it("should return original role for unknown role", () => {
      expect(getOperatorRoleLabel("unknown_role", en)).toBe("unknown_role");
    });
  });

  describe("getOperatorStatusLabel", () => {
    it("should return the label for active", () => {
      expect(getOperatorStatusLabel("active", en)).toBe("Active");
    });

    it("should return the label for inactive", () => {
      expect(getOperatorStatusLabel("inactive", en)).toBe("Inactive");
    });

    it("should return the label for suspended", () => {
      expect(getOperatorStatusLabel("suspended", en)).toBe("Suspended");
    });

    it("should return original status for unknown status", () => {
      expect(getOperatorStatusLabel("unknown_status", en)).toBe(
        "unknown_status"
      );
    });
  });

  describe("getOperatorRoleSelectItems", () => {
    it("should return labels in super-admin / operator / auditor order", () => {
      expect(getOperatorRoleSelectItems(en)).toEqual([
        { label: "Super admin", value: "platform_super_admin" },
        { label: "Operator", value: "platform_operator" },
        { label: "Auditor", value: "platform_auditor" },
      ]);
    });
  });

  describe("getOperatorRoleCardDescription", () => {
    it("should return self message when isSelf is true", () => {
      expect(
        getOperatorRoleCardDescription({ isSelf: true, isSuperAdmin: true }, en)
      ).toBe("You cannot change your own role.");
    });

    it("should return permission denied message when not super admin", () => {
      expect(
        getOperatorRoleCardDescription(
          { isSelf: false, isSuperAdmin: false },
          en
        )
      ).toBe("Only a super admin can change roles.");
    });

    it("should return success message when can modify", () => {
      expect(
        getOperatorRoleCardDescription(
          { isSelf: false, isSuperAdmin: true },
          en
        )
      ).toBe("Change this operator's role.");
    });
  });
});
