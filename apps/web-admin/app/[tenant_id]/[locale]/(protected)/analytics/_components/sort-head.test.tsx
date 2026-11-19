// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SortHead } from "./sort-head";

afterEach(cleanup);

const renderHead = (sorted: "asc" | "desc" | null) =>
  render(
    <table>
      <thead>
        <tr>
          <SortHead
            href="/analytics/revenue?sort=net&order=asc"
            sorted={sorted}
          >
            Net
          </SortHead>
        </tr>
      </thead>
    </table>
  );

describe("SortHead", () => {
  it("links to the sort a click picks", () => {
    renderHead("desc");

    expect(screen.getByRole("link", { name: "Net" }).getAttribute("href")).toBe(
      "/analytics/revenue?sort=net&order=asc"
    );
  });

  it("states the order the table is sorted in", () => {
    renderHead("desc");

    expect(screen.getByRole("columnheader").getAttribute("aria-sort")).toBe(
      "descending"
    );
  });

  it("states that a column the table is not sorted by is unsorted", () => {
    renderHead(null);

    expect(screen.getByRole("columnheader").getAttribute("aria-sort")).toBe(
      "none"
    );
  });
});
