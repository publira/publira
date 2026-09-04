import { describe, expect, it } from "vitest";

import { loadPlatformMessages } from "./locale";
import { getEndUserStatusLabel, getEndUserStatusTone } from "./user-labels";

const en = await loadPlatformMessages("en");

describe("platform-end-user-labels", () => {
  describe("getEndUserStatusLabel", () => {
    it("should return the label for active", () => {
      expect(getEndUserStatusLabel("active", en)).toBe("Active");
    });

    it("should return the label for suspended", () => {
      expect(getEndUserStatusLabel("suspended", en)).toBe("Suspended");
    });

    it("should return the label for inactive", () => {
      expect(getEndUserStatusLabel("inactive", en)).toBe("Inactive");
    });

    it("should return original status for unknown status", () => {
      expect(getEndUserStatusLabel("unknown_status", en)).toBe(
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
