import { describe, expect, it } from "vitest";

import { parseReaderPageCursors, readerPageHref } from "./search-params";

describe("parseReaderPageCursors", () => {
  it("reads each section's cursor and falls back to the first page", () => {
    expect(
      parseReaderPageCursors({
        purchases_token: " purchases-page ",
        tickets_token: ["one", "two"],
      })
    ).toEqual({
      purchases_token: "purchases-page",
      tickets_token: "",
      token: "",
    });
  });
});

describe("readerPageHref", () => {
  it("moves one section and keeps every other section on its page", () => {
    expect(
      readerPageHref(
        { purchases_token: "p2", tickets_token: "", token: "c3" },
        { tickets_token: "t2" }
      )
    ).toBe("?purchases_token=p2&tickets_token=t2&token=c3");
  });

  it("answers a bare query when every section is back on its first page", () => {
    expect(
      readerPageHref(
        { purchases_token: "p2", tickets_token: "", token: "" },
        { purchases_token: "" }
      )
    ).toBe("?");
  });
});
