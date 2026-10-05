// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EpisodeAgeGate } from "./episode-age-gate";

// `<Message>` resolves the locale through `next/root-params`, which only the
// Next.js compiler can provide. The key it was handed is what this file is
// about, so rendering the key itself keeps the assertions readable.
vi.mock("#components/locale-context", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "en",
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: string;
    values?: Record<string, string>;
  }) => (values?.date ? `${message} ${values.date}` : message),
}));

afterEach(cleanup);

const props = {
  episodePublicId: "EPISODE_001",
  locale: "en",
  seriesPublicId: "SERIES_001",
  timeZone: "Asia/Tokyo",
} as const;

/** 23:59 on Sunday 11 October in Tokyo. */
const FREE_UNTIL = "2026-10-11T14:59:00Z";

describe("EpisodeAgeGate", () => {
  it("Sends a guest to sign in", () => {
    render(<EpisodeAgeGate {...props} hasBirthDate={false} signedIn={false} />);

    expect(
      screen.getByText("host.episode.age_gate.guest_description")
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: "host.episode.gate.login" })
    ).toBeDefined();
  });

  it("Sends a reader who has given no date to their settings", () => {
    render(<EpisodeAgeGate {...props} hasBirthDate={false} signedIn />);

    expect(
      screen.getByText("host.episode.age_gate.no_birth_date_description")
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: "host.episode.age_gate.add_birth_date" })
    ).toBeDefined();
  });

  it("Offers nothing to a reader whose own date is what stops them", () => {
    render(<EpisodeAgeGate {...props} hasBirthDate signedIn />);

    expect(
      screen.getByText("host.episode.age_gate.too_young_description")
    ).toBeDefined();
    expect(
      screen.queryByRole("link", {
        name: "host.episode.age_gate.add_birth_date",
      })
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "host.episode.to_series_detail" })
    ).toBeDefined();
  });

  it("Offers no other episode to read, since the rule closes all of them", () => {
    render(<EpisodeAgeGate {...props} hasBirthDate={false} signedIn={false} />);

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(
      ["host.episode.gate.login", "host.episode.to_series_detail"]
    );
  });

  it("Says until when the episode is free while proving the age can still open it", () => {
    render(
      <EpisodeAgeGate
        {...props}
        freeUntil={FREE_UNTIL}
        hasBirthDate={false}
        signedIn={false}
      />
    );

    expect(
      screen.getByText(/^host\.common\.free_until Sun, Oct 11, 11:59/u)
    ).toBeDefined();
  });

  it("Keeps the free period from a reader who is too young to be let in by it", () => {
    render(
      <EpisodeAgeGate {...props} freeUntil={FREE_UNTIL} hasBirthDate signedIn />
    );

    expect(screen.queryByText(/host\.common\.free_until/u)).toBeNull();
  });
});
