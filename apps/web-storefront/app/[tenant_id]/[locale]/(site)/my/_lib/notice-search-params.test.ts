import { describe, expect, it } from "vitest";

import { parseMyNoticeSearchParams } from "./notice-search-params";

describe("parseMyNoticeSearchParams", () => {
  it("reads a paid checkout of a plan", () => {
    expect(parseMyNoticeSearchParams({ subscription: "success" })).toEqual({
      billing: "",
      subscription: "success",
    });
  });

  it.each(["error", "unavailable"])(
    "reads the billing outcome %s",
    (billing) => {
      expect(parseMyNoticeSearchParams({ billing })).toEqual({
        billing,
        subscription: "",
      });
    }
  );

  it("reads anything else as the page as it is", () => {
    expect(
      parseMyNoticeSearchParams({ billing: "ok", subscription: "cancelled" })
    ).toEqual({ billing: "", subscription: "" });
  });
});
