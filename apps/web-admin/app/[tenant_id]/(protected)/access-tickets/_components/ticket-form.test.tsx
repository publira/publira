// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import { listEpisodeOptionsAction } from "../_lib/actions";
import { TicketForm } from "./ticket-form";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

vi.mock("../_lib/actions", () => ({
  listEpisodeOptionsAction: vi.fn(),
}));

vi.mock("@publira/ui-components/combobox", async () => {
  const { Input } = await import("@publira/ui-components/input");

  return {
    Combobox: ({
      disabled,
      items,
      onValueChange,
      value,
    }: {
      disabled?: boolean;
      items: { label: string; value: string }[];
      onValueChange: (next: string) => void;
      value: string;
    }) => (
      <>
        <Input
          disabled={disabled}
          onChange={(event) => onValueChange(event.target.value)}
          value={value}
        />
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </>
    ),
  };
});

const mockListEpisodeOptionsAction = vi.mocked(listEpisodeOptionsAction);

const action = () => Promise.resolve({ message: "", ok: false });

const seriesA = { publicId: "SERIES001", title: "Series A" };
const seriesB = { publicId: "SERIES002", title: "Series B" };

const seriesCombobox = () => screen.getByLabelText(/Series/u);
const episodeCombobox = () => screen.getByLabelText(/^Episode/u);

const selectSeries = (item: { publicId: string; title: string }) => {
  fireEvent.change(seriesCombobox(), {
    target: { value: item.publicId },
  });
};

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleProvider locale="en">{children}</AdminLocaleProvider>
    ),
  });

afterEach(() => {
  cleanup();
});

describe("TicketForm", () => {
  beforeEach(() => {
    mockListEpisodeOptionsAction.mockReset();
  });

  it("picks an episode from the combobox when series are available and blocks issuing until one is chosen", () => {
    render(
      <TicketForm action={action} series={[seriesA]} timeZone="Asia/Tokyo" />
    );

    expect(seriesCombobox()).toBeDefined();
    expect(episodeCombobox()).toBeDefined();
    expect(screen.queryByLabelText(/Episode public_id/u)).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Issue the ticket" })
        .hasAttribute("disabled")
    ).toBe(true);
  });

  it("falls back to typing the episode public_id when the series list is empty", () => {
    render(<TicketForm action={action} series={[]} timeZone="Asia/Tokyo" />);

    expect(screen.getByLabelText(/Episode public_id/u)).toBeDefined();
    expect(screen.queryByLabelText(/^Series$/u)).toBeNull();
    expect(
      screen.getByText(
        "No series is available to pick, so enter the episode's public_id directly."
      )
    ).toBeDefined();
  });

  it("falls back to the public_id input and shows an error when the series fetch fails", () => {
    render(
      <TicketForm
        action={action}
        series={[]}
        seriesErrorMessage="Could not load the series."
        timeZone="Asia/Tokyo"
      />
    );

    expect(screen.getByLabelText(/Episode public_id/u)).toBeDefined();
    expect(screen.getByText("Could not load the series.")).toBeDefined();
  });

  it("loads the episode choices and lets one be picked once a series is selected", async () => {
    mockListEpisodeOptionsAction.mockResolvedValue({
      episodes: [{ publicId: "EPISODE001", title: "Episode 1" }],
      ok: true,
    });

    render(
      <TicketForm action={action} series={[seriesA]} timeZone="Asia/Tokyo" />
    );

    selectSeries(seriesA);

    await waitFor(() => {
      expect(mockListEpisodeOptionsAction).toHaveBeenCalledWith(
        "TENANT001",
        "SERIES001",
        "en"
      );
    });

    expect(
      await screen.findByRole("option", { name: "Episode 1 (EPISODE001)" })
    ).toBeDefined();

    fireEvent.change(episodeCombobox(), {
      target: { value: "EPISODE001" },
    });
    await waitFor(() => {
      expect(
        screen
          .getByRole("button", { name: "Issue the ticket" })
          .hasAttribute("disabled")
      ).toBe(false);
    });
  });

  it("keeps the selection UI and offers a retry when the episode fetch fails", async () => {
    mockListEpisodeOptionsAction
      .mockResolvedValueOnce({
        episodes: [],
        message: "Could not load the episodes.",
        ok: false,
      })
      .mockResolvedValueOnce({
        episodes: [{ publicId: "EPISODE001", title: "Episode 1" }],
        ok: true,
      });

    render(
      <TicketForm action={action} series={[seriesA]} timeZone="Asia/Tokyo" />
    );

    selectSeries(seriesA);

    expect(
      await screen.findByText("Could not load the episodes.")
    ).toBeDefined();
    expect(seriesCombobox()).toBeDefined();
    expect(screen.queryByLabelText(/Episode public_id/u)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("option", { name: "Episode 1 (EPISODE001)" })
    ).toBeDefined();
    expect(mockListEpisodeOptionsAction).toHaveBeenCalledTimes(2);
  });

  it("discards the stale result when series are selected in quick succession", async () => {
    const firstLoad = Promise.withResolvers<{
      episodes: { publicId: string; title: string }[];
      ok: true;
    }>();

    mockListEpisodeOptionsAction
      .mockImplementationOnce(() => firstLoad.promise)
      .mockResolvedValueOnce({
        episodes: [{ publicId: "EPISODE-B", title: "The Later Pick" }],
        ok: true,
      });

    render(
      <TicketForm
        action={action}
        series={[seriesA, seriesB]}
        timeZone="Asia/Tokyo"
      />
    );

    selectSeries(seriesA);
    selectSeries(seriesB);

    firstLoad.resolve({
      episodes: [{ publicId: "EPISODE-A", title: "The Earlier Answer" }],
      ok: true,
    });

    expect(
      await screen.findByRole("option", { name: "The Later Pick (EPISODE-B)" })
    ).toBeDefined();
    expect(
      screen.queryByRole("option", { name: "The Earlier Answer (EPISODE-A)" })
    ).toBeNull();
  });
});
