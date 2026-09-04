// @vitest-environment jsdom

import { getMessage } from "@publira/i18n";
import type { MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SeriesManager } from "./series-manager";

vi.mock("#components/message", () => ({
  Message: ({ message, values }: { message: string; values?: MessageValues }) =>
    getMessage(sharedCatalog("en"), message, values),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: React.ComponentProps<"a">) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("SeriesManager", () => {
  it("says nothing is registered yet when the first page is empty", () => {
    render(
      <SeriesManager
        locale="en"
        pageSize={20}
        series={[]}
        timeZone="Asia/Tokyo"
      />
    );

    expect(
      screen.getByText("No series have been registered yet.")
    ).toBeDefined();
    expect(screen.queryByLabelText("Series list pagination")).toBeNull();
  });

  it("does not say the whole list is empty when a later page is empty", () => {
    render(
      <SeriesManager
        locale="en"
        pageSize={20}
        previousHref="?token=previous"
        series={[]}
        timeZone="Asia/Tokyo"
      />
    );

    expect(screen.getByText("No Series to show on this page.")).toBeDefined();
    // The recovery links stay. Hiding them would leave no way back to the list.
    expect(screen.getByLabelText("Series list pagination")).toBeDefined();
  });

  it("shows only the error and does not call the list empty when the fetch fails", () => {
    render(
      <SeriesManager
        listErrorMessage="Could not load the series."
        locale="en"
        nextHref="?token=next"
        pageSize={20}
        previousHref="?token=previous"
        series={[]}
        timeZone="Asia/Tokyo"
      />
    );

    // A failed read is a failed section, so it is reported the way every other
    // screen reports one: `SectionError`, with role="alert" and a title naming
    // the list that is missing.
    const sectionError = screen.getByRole("alert");
    expect(sectionError.textContent).toContain("Could not display series");
    expect(sectionError.textContent).toContain("Could not load the series.");
    expect(
      screen.queryByText("No series have been registered yet.")
    ).toBeNull();
    expect(screen.queryByText("No Series to show on this page.")).toBeNull();
    expect(screen.queryByLabelText("Series list pagination")).toBeNull();
  });
});
