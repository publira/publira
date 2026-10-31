// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import * as Table from ".";

afterEach(cleanup);

const renderTable = () =>
  render(
    <Table.Root>
      <Table.Header>
        <Table.Row />
      </Table.Header>
      <Table.Body>
        <Table.Row>
          <Table.Cell>12</Table.Cell>
        </Table.Row>
      </Table.Body>
    </Table.Root>
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
