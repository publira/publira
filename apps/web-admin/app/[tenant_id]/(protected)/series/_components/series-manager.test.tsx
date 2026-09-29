// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderServerComponent } from "#lib/render-server-component";

import { SeriesManager } from "./series-manager";

vi.mock("#lib/messages", () => ({
  getMessagesFor: () => Promise.resolve(bindMessages(sharedCatalog("en"))),
  loadAdminMessages: () => Promise.resolve(sharedCatalog("en")),
}));

vi.mock("#components/client-message", () => ({
  ClientMessage: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
  useClientMessages: () => bindMessages(sharedCatalog("en")),
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
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
  it("says nothing is registered yet when the first page is empty", async () => {
    await renderServerComponent(
      await SeriesManager({
        filters: { ageRating: "", status: "", token: "" },
        locale: "en",
        pageSize: 20,
        series: [],
        timeZone: "UTC",
      })
    );

    expect(
      screen.getByText("No series have been registered yet.")
    ).toBeDefined();
    expect(screen.queryByLabelText("Series list pagination")).toBeNull();
  });

  it("does not say the whole list is empty when a later page is empty", async () => {
    await renderServerComponent(
      await SeriesManager({
        filters: { ageRating: "", status: "", token: "" },
        locale: "en",
        pageSize: 20,
        previousHref: "?token=previous",
        series: [],
        timeZone: "UTC",
      })
    );

    expect(screen.getByText("No Series to show on this page.")).toBeDefined();
    // The recovery links stay. Hiding them would leave no way back to the list.
    expect(screen.getByLabelText("Series list pagination")).toBeDefined();
  });

  it("shows only the error and does not call the list empty when the fetch fails", async () => {
    await renderServerComponent(
      await SeriesManager({
        filters: { ageRating: "", status: "", token: "" },
        listErrorMessage: "Could not load the series.",
        locale: "en",
        nextHref: "?token=next",
        pageSize: 20,
        previousHref: "?token=previous",
        series: [],
        timeZone: "UTC",
      })
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

  it("keeps the chosen status and age rating in the filters", async () => {
    await renderServerComponent(
      await SeriesManager({
        filters: { ageRating: "r15", status: "completed", token: "" },
        locale: "en",
        pageSize: 20,
        series: [],
        timeZone: "UTC",
      })
    );

    expect(screen.getByText("Serialization status")).toBeDefined();
    expect(screen.getByText("Age rating")).toBeDefined();
    const form = screen.getByRole("button", { name: "Apply" }).closest("form");
    expect(Object.fromEntries(new FormData(form ?? undefined))).toMatchObject({
      age_rating: "r15",
      status: "completed",
    });
  });
});
