// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";
import { listReaderOptionsAction } from "#lib/reader-options-action";

import { listEpisodeOptionsAction } from "../_lib/actions";
import type { IssueAccessTicketActionState } from "../ticket-types";
import { TicketForm } from "./ticket-form";

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

vi.mock("#lib/get-messages", () => ({
  getMessages: () => Promise.resolve(bindMessages(sharedCatalog("en"))),
}));

// The reader picker is shared, and reads the tenant from the route itself.
vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

vi.mock("#lib/reader-options-action", () => ({
  listReaderOptionsAction: vi.fn(),
}));

vi.mock("../_lib/actions", () => ({
  listEpisodeOptionsAction: vi.fn(),
}));

vi.mock("@publira/ui-components/combobox", async () => {
  const { Input } = await import("@publira/ui-components/input");

  return {
    // Typing both searches, where the picker searches, and picks the typed
    // value, so one field stands in for the text box and the list.
    Combobox: ({
      disabled,
      items,
      onSearch,
      onValueChange,
      value,
    }: {
      disabled?: boolean;
      items: { label: string; value: string }[];
      onSearch?: (query: string) => void;
      onValueChange: (next: string) => void;
      value: string;
    }) => (
      <>
        <Input
          disabled={disabled}
          onChange={(event) => {
            onSearch?.(event.target.value);
            onValueChange(event.target.value);
          }}
          value={value}
        />
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </>
    ),
    // The mocked root stands in for the whole control, so its slots render
    // nothing.
    ComboboxEmpty: () => null,
    ComboboxInput: () => null,
    ComboboxItems: () => null,
    ComboboxPopup: () => null,
  };
});

const mockListEpisodeOptionsAction = vi.mocked(listEpisodeOptionsAction);
const mockListReaderOptionsAction = vi.mocked(listReaderOptionsAction);

const action = () => Promise.resolve({ message: "", ok: false });

const seriesA = {
  id: "018f0e6a-3000-7000-8000-000000000001",
  publicId: "SERIES001",
  title: "Series A",
};
const seriesB = {
  id: "018f0e6a-3000-7000-8000-000000000002",
  publicId: "SERIES002",
  title: "Series B",
};

const episodeOne = {
  id: "018f0e6a-4000-7000-8000-000000000001",
  publicId: "EPISODE001",
  title: "Episode 1",
};

const readerCombobox = () => screen.getByLabelText(/^Reader/u);
const seriesCombobox = () => screen.getByLabelText(/Series/u);
const episodeCombobox = () => screen.getByLabelText(/^Episode/u);

const selectSeries = (item: { id: string }) => {
  fireEvent.change(seriesCombobox(), {
    target: { value: item.id },
  });
};

const issueButton = () =>
  screen.getByRole("button", { name: "Issue the ticket" });

/** Picks a reader, the seed series, and its episode, as an operator would. */
const fillTicket = async () => {
  fireEvent.change(readerCombobox(), {
    target: { value: "018f0e6a-5000-7000-8000-000000000001" },
  });
  selectSeries(seriesA);
  await screen.findByRole("option", { name: "Episode 1 (EPISODE001)" });
  fireEvent.change(episodeCombobox(), { target: { value: episodeOne.id } });
};

const renderForm = async (
  props: Omit<Parameters<typeof TicketForm>[0], "tenantId" | "timeZone">
) =>
  render(
    await TicketForm({ ...props, tenantId: "TENANT001", timeZone: "UTC" }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AdminLocaleTestProvider locale="en">
          {children}
        </AdminLocaleTestProvider>
      ),
    }
  );

afterEach(() => {
  cleanup();
});

// A control its `<fieldset>` closes keeps `disabled` false and matches
// `:disabled` instead.
const submittedControls = () => [
  readerCombobox(),
  seriesCombobox(),
  episodeCombobox(),
  screen.getByLabelText(/Expiry/u),
  screen.getByLabelText(/Note/u),
];

describe("TicketForm", () => {
  beforeEach(() => {
    mockListEpisodeOptionsAction.mockReset();
    mockListReaderOptionsAction.mockReset();
    mockListReaderOptionsAction.mockResolvedValue({ ok: true, readers: [] });
  });

  it("blocks issuing until a reader and an episode are chosen", async () => {
    await renderForm({ action, series: [seriesA] });

    expect(readerCombobox()).toBeDefined();
    expect(seriesCombobox()).toBeDefined();
    expect(episodeCombobox()).toBeDefined();
    expect(issueButton().hasAttribute("disabled")).toBe(true);
  });

  it("submits the chosen reader's and episode's internal IDs", async () => {
    mockListEpisodeOptionsAction.mockResolvedValue({
      episodes: [episodeOne],
      ok: true,
    });
    const submitted = Promise.withResolvers<FormData>();
    const recordingAction = (
      _state: IssueAccessTicketActionState,
      formData: FormData
    ) => {
      submitted.resolve(formData);
      return Promise.resolve<IssueAccessTicketActionState>(null);
    };

    await renderForm({ action: recordingAction, series: [seriesA] });
    await fillTicket();
    await waitFor(() => {
      expect(issueButton().hasAttribute("disabled")).toBe(false);
    });
    fireEvent.click(issueButton());

    const formData = await submitted.promise;
    expect(formData.get("user_id")).toBe(
      "018f0e6a-5000-7000-8000-000000000001"
    );
    expect(formData.get("episode_id")).toBe(
      "018f0e6a-4000-7000-8000-000000000001"
    );
    expect(formData.has("user_public_id")).toBe(false);
    expect(formData.has("episode_public_id")).toBe(false);
  });

  it("says there is no episode to grant when the series list is empty", async () => {
    await renderForm({ action, series: [] });

    expect(
      screen.getByText(
        "No series is available, so there is no episode to grant."
      )
    ).toBeDefined();
    expect(issueButton().hasAttribute("disabled")).toBe(true);
  });

  it("shows the series fetch error beside the series picker", async () => {
    await renderForm({
      action,
      series: [],
      seriesErrorMessage: "Could not load the series.",
    });

    expect(screen.getByText("Could not load the series.")).toBeDefined();
    expect(seriesCombobox()).toBeDefined();
  });

  it("loads the episode choices and lets one be picked once a series is selected", async () => {
    mockListEpisodeOptionsAction.mockResolvedValue({
      episodes: [episodeOne],
      ok: true,
    });

    await renderForm({ action, series: [seriesA] });

    selectSeries(seriesA);

    await waitFor(() => {
      expect(mockListEpisodeOptionsAction).toHaveBeenCalledWith(
        "TENANT001",
        "018f0e6a-3000-7000-8000-000000000001",
        "en"
      );
    });

    expect(
      await screen.findByRole("option", { name: "Episode 1 (EPISODE001)" })
    ).toBeDefined();
  });

  it("keeps the selection UI and offers a retry when the episode fetch fails", async () => {
    mockListEpisodeOptionsAction
      .mockResolvedValueOnce({
        episodes: [],
        message: "Could not load the episodes.",
        ok: false,
      })
      .mockResolvedValueOnce({
        episodes: [episodeOne],
        ok: true,
      });

    await renderForm({ action, series: [seriesA] });

    selectSeries(seriesA);

    expect(
      await screen.findByText("Could not load the episodes.")
    ).toBeDefined();
    expect(seriesCombobox()).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("option", { name: "Episode 1 (EPISODE001)" })
    ).toBeDefined();
    expect(mockListEpisodeOptionsAction).toHaveBeenCalledTimes(2);
  });

  it("discards the stale result when series are selected in quick succession", async () => {
    const firstLoad = Promise.withResolvers<{
      episodes: { id: string; publicId: string; title: string }[];
      ok: true;
    }>();

    mockListEpisodeOptionsAction
      .mockImplementationOnce(() => firstLoad.promise)
      .mockResolvedValueOnce({
        episodes: [
          {
            id: "018f0e6a-4000-7000-8000-00000000000b",
            publicId: "EPISODE-B",
            title: "The Later Pick",
          },
        ],
        ok: true,
      });

    await renderForm({ action, series: [seriesA, seriesB] });

    selectSeries(seriesA);
    selectSeries(seriesB);

    firstLoad.resolve({
      episodes: [
        {
          id: "018f0e6a-4000-7000-8000-00000000000a",
          publicId: "EPISODE-A",
          title: "The Earlier Answer",
        },
      ],
      ok: true,
    });

    expect(
      await screen.findByRole("option", { name: "The Later Pick (EPISODE-B)" })
    ).toBeDefined();
    expect(
      screen.queryByRole("option", { name: "The Earlier Answer (EPISODE-A)" })
    ).toBeNull();
  });

  // The Action carries what the fields held when the form was submitted, so a
  // change made while it is in flight would not be the ticket that is issued.
  it("closes every field while the ticket is being issued", async () => {
    mockListEpisodeOptionsAction.mockResolvedValue({
      episodes: [episodeOne],
      ok: true,
    });
    // Never resolved: the assertions are about the window the save is open in.
    const issue = Promise.withResolvers<IssueAccessTicketActionState>();

    await renderForm({ action: () => issue.promise, series: [seriesA] });
    await fillTicket();

    for (const control of submittedControls()) {
      expect(control.matches(":disabled")).toBe(false);
    }

    fireEvent.click(issueButton());

    await waitFor(() => {
      for (const control of submittedControls()) {
        expect(control.matches(":disabled")).toBe(true);
      }
    });
  });
});
