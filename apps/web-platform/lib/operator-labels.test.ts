import { describe, expect, it } from "vitest";

import {
  getOperatorRoleCardDescription,
  getOperatorRoleLabel,
  getOperatorStatusLabel,
} from "./operator-labels";

describe("platform-operator-labels", () => {
  describe("getOperatorRoleLabel", () => {
    it("should return Japanese label for platform_super_admin", () => {
      expect(getOperatorRoleLabel("platform_super_admin")).toBe(
        "スーパー管理者"
      );
    });

    it("should return Japanese label for platform_operator", () => {
      expect(getOperatorRoleLabel("platform_operator")).toBe("オペレーター");
    });

    it("should return Japanese label for platform_auditor", () => {
      expect(getOperatorRoleLabel("platform_auditor")).toBe("監査担当");
    });

    it("should return original role for unknown role", () => {
      expect(getOperatorRoleLabel("unknown_role")).toBe("unknown_role");
    });
  });

  describe("getOperatorStatusLabel", () => {
    it("should return Japanese label for active", () => {
      expect(getOperatorStatusLabel("active")).toBe("有効");
    });

    it("should return Japanese label for inactive", () => {
      expect(getOperatorStatusLabel("inactive")).toBe("無効");
    });

    it("should return Japanese label for suspended", () => {
      expect(getOperatorStatusLabel("suspended")).toBe("停止中");
    });

    it("should return original status for unknown status", () => {
      expect(getOperatorStatusLabel("unknown_status")).toBe("unknown_status");
    });
  });

  describe("getOperatorRoleCardDescription", () => {
    it("should return self message when isSelf is true", () => {
      expect(
        getOperatorRoleCardDescription({ isSelf: true, isSuperAdmin: true })
      ).toBe("自分自身のロールは変更できません。");
    });

    it("should return permission denied message when not super admin", () => {
      expect(
        getOperatorRoleCardDescription({ isSelf: false, isSuperAdmin: false })
      ).toBe("ロールの変更はスーパー管理者のみ実行できます。");
    });

    it("should return success message when can modify", () => {
      expect(
        getOperatorRoleCardDescription({ isSelf: false, isSuperAdmin: true })
      ).toBe("オペレーターのロールを変更します。");
    });
  });
});
