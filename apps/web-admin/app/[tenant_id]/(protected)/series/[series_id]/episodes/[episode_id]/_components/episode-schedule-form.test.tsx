// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import { EpisodeForm } from "../../_components/episode-form";
import type { EpisodeEditActionState } from "../episode-edit-types";
import { EpisodeScheduleForm } from "./episode-schedule-form";

const render = (ui: React.ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
    ),
  });

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

afterEach(() => {
  cleanup();
});

describe("EpisodeScheduleForm", () => {
  const action = vi.fn(() => Promise.resolve(null));

  it("shows scheduledAt as a wall clock in the tenant time zone", () => {
    render(
      <EpisodeScheduleForm
        action={action}
        episodePublicId="EP001"
        scheduledAt="2030-01-01T01:00:00Z"
        seriesPublicId="SERIES001"
        timeZone="Asia/Seoul"
      />
    );

    const localInput = screen.getByLabelText<HTMLInputElement>(/publish_at/u);

    expect(localInput.value).toBe("2030-01-01T10:00");
  });

  it("leaves the input empty when nothing is scheduled", () => {
    render(
      <EpisodeScheduleForm
        action={action}
        episodePublicId="EP001"
        seriesPublicId="SERIES001"
        timeZone="Asia/Seoul"
      />
    );

    const localInput = screen.getByLabelText<HTMLInputElement>(/publish_at/u);

    expect(localInput.value).toBe("");
  });

  it("keeps the ids unique when it is mounted alongside the create form", () => {
    render(
      <>
        <EpisodeForm
          action={() => Promise.resolve(null)}
          seriesPublicId="SERIES001"
          timeZone="Asia/Seoul"
        />
        <EpisodeScheduleForm
          action={action}
          episodePublicId="EP001"
          scheduledAt="2030-01-01T01:00:00Z"
          seriesPublicId="SERIES001"
          timeZone="Asia/Seoul"
        />
      </>
    );

    const ids = [...document.querySelectorAll("[id]")].map(
      (element) => element.id
    );

    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toHaveLength(new Set(ids).size);
    expect(screen.getAllByLabelText(/publish_at/u)).toHaveLength(2);
  });

  // The Action carries the time the field held when the form was submitted, so
  // a change made while it is in flight would sit there unsaved.
  it("closes the time field while the save is in flight", async () => {
    // Never resolved: the assertions are about the window the save is open in.
    const save = Promise.withResolvers<EpisodeEditActionState>();
    const pendingAction = vi.fn(() => save.promise);

    render(
      <EpisodeScheduleForm
        action={pendingAction}
        episodePublicId="EP001"
        seriesPublicId="SERIES001"
        timeZone="UTC"
      />
    );

    const localInput = screen.getByLabelText<HTMLInputElement>(/publish_at/u);

    expect(localInput.matches(":disabled")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Update publish_at" }));

    await waitFor(() => {
      expect(localInput.matches(":disabled")).toBe(true);
    });
  });
});
