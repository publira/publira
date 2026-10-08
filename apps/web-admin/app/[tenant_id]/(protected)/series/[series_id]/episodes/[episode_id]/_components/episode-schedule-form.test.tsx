// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import { EpisodeForm } from "../../_components/episode-form";
import type { EpisodeEditActionState } from "../episode-edit-types";
import { EpisodeScheduleForm } from "./episode-schedule-form";

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
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

describe("EpisodeScheduleForm", () => {
  const action = vi.fn(() => Promise.resolve(null));

  it("shows scheduledAt as a wall clock in the tenant time zone", () => {
    render(
      <EpisodeScheduleForm
        action={action}
        episodeId="EP001-ID"
        episodePublicId="EP001"
        scheduledAt="2030-01-01T01:00:00Z"
        seriesPublicId="SERIES001"
        tenantId="TENANT001"
        timeZone="Asia/Seoul"
      />
    );

    const localInput = screen.getByLabelText<HTMLInputElement>(
      /Publication date and time/u
    );

    expect(localInput.value).toBe("2030-01-01T10:00");
    expect(
      document.querySelector<HTMLInputElement>('input[name="publish_at"]')
        ?.value
    ).toBe("2030-01-01T01:00:00Z");
  });

  // Rescheduling keeps its future-only rule, so the field does not promise
  // what the create form's does.
  it("names the tenant time zone without promising to publish a past time", () => {
    render(
      <EpisodeScheduleForm
        action={action}
        episodeId="EP001-ID"
        episodePublicId="EP001"
        scheduledAt=""
        seriesPublicId="SERIES001"
        tenantId="TENANT001"
        timeZone="Asia/Seoul"
      />
    );

    expect(
      screen.getByText(
        "The date and time are interpreted as wall-clock time in the tenant time zone (Asia/Seoul)."
      )
    ).toBeTruthy();
    expect(screen.queryByText(/as soon as it is created/u)).toBeNull();
  });

  it("leaves the input empty when nothing is scheduled", () => {
    render(
      <EpisodeScheduleForm
        action={action}
        episodeId="EP001-ID"
        episodePublicId="EP001"
        seriesPublicId="SERIES001"
        tenantId="TENANT001"
        timeZone="Asia/Seoul"
      />
    );

    const localInput = screen.getByLabelText<HTMLInputElement>(
      /Publication date and time/u
    );

    expect(localInput.value).toBe("");
  });

  it("keeps the ids unique when it is mounted alongside the create form", async () => {
    const createForm = await EpisodeForm({
      action: () => Promise.resolve(null),
      seriesId: "SERIES001-ID",
      seriesPublicId: "SERIES001",
      seriesReadingPeriodHours: 0,
      tenantId: "TENANT001",
      timeZone: "Asia/Seoul",
    });

    render(
      <>
        {createForm}
        <EpisodeScheduleForm
          action={action}
          episodeId="EP001-ID"
          episodePublicId="EP001"
          scheduledAt="2030-01-01T01:00:00Z"
          seriesPublicId="SERIES001"
          tenantId="TENANT001"
          timeZone="Asia/Seoul"
        />
      </>
    );

    const ids = [...document.querySelectorAll("[id]")].map(
      (element) => element.id
    );

    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toHaveLength(new Set(ids).size);
    expect(screen.getAllByLabelText(/Publication date and time/u)).toHaveLength(
      2
    );
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
        episodeId="EP001-ID"
        episodePublicId="EP001"
        seriesPublicId="SERIES001"
        tenantId="TENANT001"
        timeZone="UTC"
      />
    );

    const localInput = screen.getByLabelText<HTMLInputElement>(
      /Publication date and time/u
    );

    expect(localInput.matches(":disabled")).toBe(false);

    fireEvent.click(
      screen.getByRole("button", { name: "Update publication date and time" })
    );

    await waitFor(() => {
      expect(localInput.matches(":disabled")).toBe(true);
    });
  });
});
