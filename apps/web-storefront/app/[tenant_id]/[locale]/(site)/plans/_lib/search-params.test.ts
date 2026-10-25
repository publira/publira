import { describe, expect, it } from "vitest";

import { parsePlansSearchParams } from "./search-params";

describe("parsePlansSearchParams", () => {
  it.each(["cancelled", "error", "unavailable"])(
    "reads the outcome %s",
    (subscription) => {
      expect(parsePlansSearchParams({ subscription })).toEqual({
        subscription,
      });
    }
  );

  it("reads anything else as the page as it is", () => {
    expect(parsePlansSearchParams({ subscription: "success" })).toEqual({
      subscription: "",
    });
    expect(parsePlansSearchParams({})).toEqual({ subscription: "" });
  });
});
