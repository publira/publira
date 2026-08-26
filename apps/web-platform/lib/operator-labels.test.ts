import { describe, expect, it } from "vitest";

import { loadPlatformMessages } from "./locale";
import {
  getOperatorRoleCardDescription,
  getOperatorRoleLabel,
  getOperatorRoleSelectItems,
  getOperatorStatusLabel,
} from "./operator-labels";

const ja = await loadPlatformMessages("ja");
const en = await loadPlatformMessages("en");

describe("platform-operator-labels", () => {
  describe("getOperatorRoleLabel", () => {
    it("should return Japanese label for platform_super_admin", () => {
      expect(getOperatorRoleLabel("platform_super_admin", ja)).toBe(
        "スーパー管理者"
      );
    });

    it("should return English label when the catalog is en", () => {
      expect(getOperatorRoleLabel("platform_operator", en)).toBe("Operator");
    });

    it("should return Japanese label for platform_operator", () => {
      expect(getOperatorRoleLabel("platform_operator", ja)).toBe(
        "オペレーター"
      );
    });

    it("should return Japanese label for platform_auditor", () => {
      expect(getOperatorRoleLabel("platform_auditor", ja)).toBe("監査担当");
    });

    it("should return original role for unknown role", () => {
      expect(getOperatorRoleLabel("unknown_role", ja)).toBe("unknown_role");
    });
  });

  describe("getOperatorStatusLabel", () => {
    it("should return Japanese label for active", () => {
      expect(getOperatorStatusLabel("active", ja)).toBe("有効");
    });

    it("should return Japanese label for inactive", () => {
      expect(getOperatorStatusLabel("inactive", ja)).toBe("無効");
    });

    it("should return Japanese label for suspended", () => {
      expect(getOperatorStatusLabel("suspended", ja)).toBe("停止中");
    });

    it("should return original status for unknown status", () => {
      expect(getOperatorStatusLabel("unknown_status", ja)).toBe(
        "unknown_status"
      );
    });
  });

  describe("getOperatorRoleSelectItems", () => {
    it("should return Japanese labels in super-admin / operator / auditor order", () => {
      expect(getOperatorRoleSelectItems(ja)).toEqual([
        { label: "スーパー管理者", value: "platform_super_admin" },
        { label: "オペレーター", value: "platform_operator" },
        { label: "監査担当", value: "platform_auditor" },
      ]);
    });

    it("should return English labels when the catalog is en", () => {
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
        getOperatorRoleCardDescription({ isSelf: true, isSuperAdmin: true }, ja)
      ).toBe("自分自身のロールは変更できません。");
    });

    it("should return permission denied message when not super admin", () => {
      expect(
        getOperatorRoleCardDescription(
          { isSelf: false, isSuperAdmin: false },
          ja
        )
      ).toBe("ロールの変更はスーパー管理者のみ実行できます。");
    });

    it("should return success message when can modify", () => {
      expect(
        getOperatorRoleCardDescription(
          { isSelf: false, isSuperAdmin: true },
          ja
        )
      ).toBe("オペレーターのロールを変更します。");
    });
  });
});
