import { describe, expect, it } from "vitest";

import { parseSettingsFlashSearchParams } from "./search-params";

describe("parseSettingsFlashSearchParams", () => {
  it("reads a success flash and drops an unknown status", () => {
    expect(
      parseSettingsFlashSearchParams({
        message: "  保存しました  ",
        status: "success",
      })
    ).toEqual({ message: "保存しました", status: "success" });
    expect(
      parseSettingsFlashSearchParams({
        message: "失敗しました",
        status: "nope",
      })
    ).toEqual({ message: "失敗しました", status: "" });
  });

  it("defaults to an empty flash when the query is missing", () => {
    expect(parseSettingsFlashSearchParams({})).toEqual({
      message: "",
      status: "",
    });
  });
});
