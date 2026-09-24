// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import type { FormActionState } from "@publira/ui-components/action-form";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EpisodeAvailabilityForm } from "./episode-availability-form";

const translate = bindMessages(sharedCatalog("en"));

vi.mock("#components/client-message", () => ({
  ClientMessage: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => translate(message, values),
  useClientMessages: () => translate,
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => translate(message, values),
}));

const action = () => Promise.resolve(null);

const renderForm = (
  props: Pick<
    Parameters<typeof EpisodeAvailabilityForm>[0],
    "initialAvailability" | "seriesAvailability"
  >
) =>
  render(
    <EpisodeAvailabilityForm
      action={action}
      episodePublicId="EP001"
      seriesPublicId="SERIES001"
      tenantId="TENANT001"
      {...props}
    />
  );

/** What the form would post under one field name, in document order. */
const posted = (name: string) =>
  [
    ...document.querySelectorAll<HTMLInputElement>(
      `input[type="hidden"][name="${name}"]`
    ),
  ].map((input) => input.value);

/**
 * Whether a control refuses input, whichever way it says so. A native control
 * closed by its `<fieldset>` keeps `disabled` false and matches `:disabled`.
 */
const isClosed = (element: HTMLElement) =>
  element.matches(":disabled") ||
  element.getAttribute("aria-disabled") === "true" ||
  Object.hasOwn(element.dataset, "disabled");

afterEach(() => {
  cleanup();
});

describe("EpisodeAvailabilityForm", () => {
  // An operator should not have to open the series to learn what following it
  // means for this episode.
  it("names what the episode follows where it overrides nothing", () => {
    renderForm({ initialAvailability: "", seriesAvailability: "web" });

    expect(posted("availability")).toEqual([""]);
    expect(screen.getByRole("combobox", { name: "Shown on" }).textContent).toBe(
      "Follow the series (Web only)"
    );
  });

  it("opens on the surfaces the episode states of its own", () => {
    renderForm({ initialAvailability: "app", seriesAvailability: "all" });

    expect(posted("availability")).toEqual(["app"]);
    expect(screen.getByRole("combobox", { name: "Shown on" }).textContent).toBe(
      "App only"
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  // The series bounds the episode, so naming the surface the series is kept
  // off hides the episode everywhere — which the operator must see before
  // saving it.
  it("warns when the episode would be shown nowhere", () => {
    renderForm({ initialAvailability: "app", seriesAvailability: "web" });

    expect(screen.getByRole("status").textContent).toContain(
      "this episode will not be shown anywhere"
    );
  });

  // A series read that failed must not put a guessed value in its place.
  it("says only that it follows the series when the series could not be read", () => {
    renderForm({ initialAvailability: "" });

    expect(screen.getByRole("combobox", { name: "Shown on" }).textContent).toBe(
      "Follow the series"
    );
  });

  // The Action carries what the form held when it was submitted, so a change
  // made while it is in flight would sit under the success message unsaved.
  it("closes the field while the save is in flight", async () => {
    const save = Promise.withResolvers<FormActionState>();
    render(
      <EpisodeAvailabilityForm
        action={() => save.promise}
        episodePublicId="EP001"
        initialAvailability="app"
        seriesAvailability="all"
        seriesPublicId="SERIES001"
        tenantId="TENANT001"
      />
    );
    const field = screen.getByRole("combobox", { name: "Shown on" });

    expect(isClosed(field)).toBe(false);

    fireEvent.click(
      screen.getByRole("button", { name: "Update where it is shown" })
    );

    await waitFor(() => {
      expect(isClosed(field)).toBe(true);
    });

    save.resolve(null);
    await waitFor(() => {
      expect(isClosed(field)).toBe(false);
    });
  });
});
