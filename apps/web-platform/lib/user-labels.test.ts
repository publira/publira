import { describe, expect, it } from "vitest";

import { getEndUserStatusLabel, getEndUserStatusTone } from "./user-labels";

const en = "en" as const;

describe("platform-end-user-labels", () => {
  describe("getEndUserStatusLabel", () => {
    it("should return the label for active", async () => {
      await expect(getEndUserStatusLabel("active", en)).resolves.toBe("Active");
    });

    it("should return the label for suspended", async () => {
      await expect(getEndUserStatusLabel("suspended", en)).resolves.toBe(
        "Suspended"
      );
    });

    it("should return the label for inactive", async () => {
      await expect(getEndUserStatusLabel("inactive", en)).resolves.toBe(
        "Inactive"
      );
    });

    it("should return original status for unknown status", async () => {
      await expect(getEndUserStatusLabel("unknown_status", en)).resolves.toBe(
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
