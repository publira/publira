// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EpisodeAgeGate } from "./episode-age-gate";

// `<Message>` resolves the locale through `next/root-params`, which only the
// Next.js compiler can provide. The key it was handed is what this file is
// about, so rendering the key itself keeps the assertions readable.
vi.mock("#components/locale-provider", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "en",
}));

vi.mock("#components/message", () => ({
  Message: ({ message }: { message: string }) => message,
}));

afterEach(cleanup);

const props = {
  episodePublicId: "EPISODE_001",
  seriesPublicId: "SERIES_001",
};

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
});
