import { describe, expect, it } from "vitest";

import { parseAccessTicketFilters } from "./search-params";

describe("parseAccessTicketFilters", () => {
  it("normalizes the page token and the filters", () => {
    expect(
      parseAccessTicketFilters({
        active: "1",
        episode: " EPISODE001 ",
        token: " page-token ",
        user: " USER001 ",
      })
    ).toEqual({
      active: true,
      episode: "EPISODE001",
      token: "page-token",
      user: "USER001",
    });
  });

  it("empties repeated and invalid filter values", () => {
    expect(
      parseAccessTicketFilters({
        active: "maybe",
        episode: ["EPISODE001", "EPISODE002"],
        token: ["first", "second"],
        user: ["USER001", "USER002"],
      })
    ).toEqual({
      active: false,
      episode: "",
      token: "",
      user: "",
    });
  });

  it("treats missing search params as the first page with no filter", () => {
    expect(parseAccessTicketFilters({})).toEqual({
      active: false,
      episode: "",
      token: "",
      user: "",
    });
  });
});
