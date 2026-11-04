import { describe, expect, it } from "vitest";

import * as EntryList from "./entry-list";

describe("splitPastedEntries", () => {
  it("takes one entry a line, trimmed, whatever the line endings", () => {
    expect(
      EntryList.splitPastedEntries(
        "  one.example \r\n\r\ntwo@example.com\rthree.example\n\n"
      )
    ).toEqual(["one.example", "two@example.com", "three.example"]);
  });
});
