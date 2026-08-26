import { describe, expect, it } from "vitest";

import { loadPlatformMessages } from "./locale";
import { getEndUserStatusLabel, getEndUserStatusTone } from "./user-labels";

const ja = await loadPlatformMessages("ja");

describe("platform-end-user-labels", () => {
  describe("getEndUserStatusLabel", () => {
    it("should return Japanese label for active", () => {
      expect(getEndUserStatusLabel("active", ja)).toBe("有効");
    });

    it("should return Japanese label for suspended", () => {
      expect(getEndUserStatusLabel("suspended", ja)).toBe("停止中");
    });

    it("should return Japanese label for inactive", () => {
      expect(getEndUserStatusLabel("inactive", ja)).toBe("無効");
    });

    it("should return original status for unknown status", () => {
      expect(getEndUserStatusLabel("unknown_status", ja)).toBe(
        "unknown_status"
      );
    });
  });

  describe("getEndUserStatusTone", () => {
    it("should return success tone for active", () => {
      expect(getEndUserStatusTone("active")).toBe("success");
    });

    it("should return destructive tone for suspended", () => {
      expect(getEndUserStatusTone("suspended")).toBe("destructive");
    });

    it("should return info tone for unknown statuses", () => {
      expect(getEndUserStatusTone("inactive")).toBe("info");
      expect(getEndUserStatusTone("unknown")).toBe("info");
    });
  });
});
