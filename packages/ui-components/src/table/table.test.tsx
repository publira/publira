// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Table, TableBody, TableCell, TableHeader, TableRow } from "./table";

afterEach(cleanup);

const renderTable = () =>
  render(
    <Table>
      <TableHeader>
        <TableRow />
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>12</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );

describe("Table", () => {
  it("lines up the figures in a column", () => {
    const { container } = renderTable();

    expect(container.querySelector("table")?.classList).toContain(
      "tabular-nums"
    );
  });

  it("rules the header more heavily than the rows below it", () => {
    const { container } = renderTable();

    const headerClasses = [
      ...(container.querySelector("thead")?.classList ?? []),
    ];
    const rowClasses = [
      ...(container.querySelector("tbody tr")?.classList ?? []),
    ];

    expect(headerClasses).toContain("[&_tr]:border-b-2");
    expect(rowClasses).toContain("border-b");
    expect(rowClasses).not.toContain("border-b-2");
  });

  it("wraps the table in nothing that draws a second boundary", () => {
    const { container } = renderTable();

    const wrapper = container.firstElementChild;
    expect([...(wrapper?.classList ?? [])]).toEqual([
      "w-full",
      "overflow-auto",
    ]);
  });
});
