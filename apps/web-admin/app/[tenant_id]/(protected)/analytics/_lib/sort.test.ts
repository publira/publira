import { describe, expect, it } from "vitest";

import { nextSort, parseSortSearchParams, sortRows } from "./sort";
import type { SortColumns } from "./sort";

type Column = "net" | "title";

const columns: SortColumns<Column> = { net: "desc", title: "asc" };

describe("parseSortSearchParams", () => {
  it("reads the column and the order", () => {
    expect(
      parseSortSearchParams({ order: "asc", sort: "net" }, columns, "title")
    ).toEqual({ column: "net", order: "asc" });
  });

  it("sorts a column without an order in its first order", () => {
    expect(parseSortSearchParams({ sort: "net" }, columns, "title")).toEqual({
      column: "net",
      order: "desc",
    });
  });

  it("falls back on a column the table does not have", () => {
    expect(
      parseSortSearchParams(
        { order: "sideways", sort: "rating" },
        columns,
        "net"
      )
    ).toEqual({ column: "net", order: "desc" });
  });
});

describe("nextSort", () => {
  it("turns the column already sorted by the other way", () => {
    expect(nextSort({ column: "net", order: "desc" }, "net", columns)).toEqual({
      column: "net",
      order: "asc",
    });
  });

  it("sorts another column in its first order", () => {
    expect(nextSort({ column: "net", order: "asc" }, "title", columns)).toEqual(
      { column: "title", order: "asc" }
    );
  });
});

describe("sortRows", () => {
  const rows = [
    { net: 5, title: "Episode 10" },
    { net: -2, title: "Episode 2" },
    { net: 5, title: "episode 1" },
  ];

  const value = (row: (typeof rows)[number], column: Column) => row[column];

  it("orders figures as numbers, keeping the API's order on a tie", () => {
    expect(
      sortRows(rows, { column: "net", order: "desc" }, value, "en").map(
        (row) => row.title
      )
    ).toEqual(["Episode 10", "episode 1", "Episode 2"]);
  });

  it("orders titles the way the locale orders words", () => {
    expect(
      sortRows(rows, { column: "title", order: "asc" }, value, "en").map(
        (row) => row.title
      )
    ).toEqual(["episode 1", "Episode 2", "Episode 10"]);
  });

  it("leaves the rows it was given as they were", () => {
    sortRows(rows, { column: "net", order: "asc" }, value, "en");

    expect(rows[0]?.title).toBe("Episode 10");
  });
});
