// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EpisodeReviewRoundItem } from "#lib/episode-review";

import { EpisodeReviewSection } from "./episode-review-section";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

afterEach(() => {
  cleanup();
});

const returned: EpisodeReviewRoundItem = {
  comment: "Page 3 is upside down.\nPlease fix it.",
  decidedAt: "2026-11-02T10:30:00Z",
  decidedByName: "Ada Admin",
  id: "ROUND1",
  state: "returned",
  submittedAt: "2026-11-01T09:00:00Z",
  submittedByName: "Eddie Editor",
};

const waiting: EpisodeReviewRoundItem = {
  comment: "",
  decidedAt: "",
  decidedByName: "",
  id: "ROUND2",
  state: "in_review",
  submittedAt: "2026-11-03T09:00:00Z",
  submittedByName: "",
};

describe("EpisodeReviewSection", () => {
  it("lists every round in order, with who did what and the comment", () => {
    render(
      <EpisodeReviewSection
        locale="en"
        rounds={[returned, waiting]}
        state="in_review"
        timeZone="UTC"
      />
    );

    const [first, second] = screen.getAllByRole("listitem");

    expect(
      within(first).getByText(/^Submitted by Eddie Editor on /u)
    ).toBeDefined();
    expect(
      within(first).getByText(/^Returned by Ada Admin on /u)
    ).toBeDefined();
    expect(
      within(first).getByText(/Page 3 is upside down\.\s+Please fix it\./u)
    ).toBeDefined();
    // An account deleted since leaves the round without a name.
    expect(within(second).getByText(/^Submitted on /u)).toBeDefined();
    expect(
      within(second).getByText("Waiting for a Tenant admin's decision.")
    ).toBeDefined();
  });

  it("says when the episode was never submitted", () => {
    render(
      <EpisodeReviewSection locale="en" rounds={[]} state="" timeZone="UTC" />
    );

    expect(
      screen.getByText("This episode has not been submitted for review.")
    ).toBeDefined();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("renders the decision controls it is given beneath the rounds", () => {
    render(
      <EpisodeReviewSection
        locale="en"
        rounds={[waiting]}
        state="in_review"
        timeZone="UTC"
      >
        <button type="button">Decide</button>
      </EpisodeReviewSection>
    );

    expect(screen.getByRole("button", { name: "Decide" })).toBeDefined();
  });
});
