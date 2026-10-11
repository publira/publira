import { describe, expect, it } from "vitest";

import { parseSettingsFlashSearchParams } from "./search-params";

describe("parseSettingsFlashSearchParams", () => {
  it("reads a success flash and drops an unknown status", () => {
    expect(
      parseSettingsFlashSearchParams({
        message: "  Saved  ",
        status: "success",
      })
    ).toEqual({ message: "Saved", status: "success" });
    expect(
      parseSettingsFlashSearchParams({
        message: "Something went wrong",
        status: "nope",
      })
    ).toEqual({ message: "Something went wrong", status: "" });
  });

  it("defaults to an empty flash when the query is missing", () => {
    expect(parseSettingsFlashSearchParams({})).toEqual({
      message: "",
      status: "",
    });
  });
});
