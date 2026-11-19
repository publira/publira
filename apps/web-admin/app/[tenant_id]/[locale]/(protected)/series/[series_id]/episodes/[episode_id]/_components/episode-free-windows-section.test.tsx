// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import * as Toast from "@publira/ui-components/toast";
import {
  cleanup,
  render as renderBase,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";
import type { EpisodeFreeWindowItem } from "#lib/episode-free-window";

import { EpisodeFreeWindowsSection } from "./episode-free-windows-section";

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleTestProvider locale="en">
        <Toast.Provider>{children}</Toast.Provider>
      </AdminLocaleTestProvider>
    ),
  });

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

vi.mock("#lib/get-messages", () => ({
  getMessages: () => Promise.resolve(bindMessages(sharedCatalog("en"), "en")),
}));

afterEach(() => {
  cleanup();
});

const freeWindow = (
  overrides: Partial<EpisodeFreeWindowItem>
): EpisodeFreeWindowItem => ({
  endsAt: "2026-10-12T00:00:00Z",
  episodeId: "018f0e6a-3000-7000-8000-000000000001",
  episodePublicId: "EPISODE001",
  episodeTitle: "Chapter One",
  id: "018f0e6a-4000-7000-8000-000000000001",
  ruleSeriesId: "",
  startsAt: "2026-10-10T00:00:00Z",
  ...overrides,
});

const renderSection = (freeWindows: readonly EpisodeFreeWindowItem[]) =>
  render(
    <EpisodeFreeWindowsSection
      createAction={() => Promise.resolve(null)}
      deleteAction={() => Promise.resolve(null)}
      episodeId="018f0e6a-3000-7000-8000-000000000001"
      episodePublicId="EPISODE001"
      freeWindows={freeWindows}
      locale="en"
      now={Temporal.Instant.from("2026-10-11T00:00:00Z")}
      seriesPublicId="SERIES001"
      tenantId="TENANT001"
      timeZone="UTC"
    />
  );

describe("EpisodeFreeWindowsSection", () => {
  it("offers Delete on a period scheduled by hand", () => {
    renderSection([freeWindow({})]);

    const row = screen.getByRole("listitem");
    expect(within(row).getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(within(row).queryByText("By the series rule")).toBeNull();
  });

  // The API refuses to delete a rule's period, and its far end is no date an
  // editor schedules against.
  it("marks a period the series rule wrote instead of offering Delete", () => {
    renderSection([
      freeWindow({
        endsAt: "9999-12-31T00:00:00Z",
        ruleSeriesId: "018f0e6a-2000-7000-8000-000000000001",
      }),
    ]);

    const row = screen.getByRole("listitem");
    expect(within(row).getByText("By the series rule")).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(within(row).getByText("Free now")).toBeTruthy();
    expect(row.textContent).not.toContain("9999");
  });
});
