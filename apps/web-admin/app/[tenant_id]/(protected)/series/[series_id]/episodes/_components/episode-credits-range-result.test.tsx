// @vitest-environment jsdom

import { cleanup, render as renderBase, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import { EpisodeCreditsRangeResult } from "./episode-credits-range-result";

const episodes = Array.from({ length: 40 }, (_, index) => ({
  publicId: `EP${String(index + 1).padStart(2, "0")}`,
  title: `Episode ${index + 1}`,
}));

const render = (
  result: Parameters<typeof EpisodeCreditsRangeResult>[0]["result"]
) =>
  renderBase(
    <EpisodeCreditsRangeResult episodes={episodes} result={result} />,
    {
      wrapper: ({ children }) => (
        <AdminLocaleTestProvider locale="en">
          {children}
        </AdminLocaleTestProvider>
      ),
    }
  );

afterEach(cleanup);

describe("EpisodeCreditsRangeResult", () => {
  it("lists the episodes the operation wrote on, in the order they were changed", () => {
    render({
      changedEpisodePublicIds: ["EP01", "EP02", "EP11"],
      ok: true,
      unchangedEpisodes: [],
    });

    expect(screen.getByText("Changed 3 episodes")).toBeDefined();
    expect(screen.getByText("Episode 1")).toBeDefined();
    expect(screen.getByText("Episode 2")).toBeDefined();
    expect(screen.getByText("Episode 11")).toBeDefined();
    expect(screen.queryByText("Episode 12")).toBeNull();
  });

  it("lists skipped episodes with the reason the server gave", () => {
    render({
      changedEpisodePublicIds: ["EP01"],
      ok: true,
      unchangedEpisodes: [
        { episodePublicId: "EP07", reason: "credited_on_the_episode" },
        { episodePublicId: "EP08", reason: "not_credited" },
        { episodePublicId: "EP09", reason: "already_credited" },
      ],
    });

    expect(screen.getByText("Left 3 episodes unchanged")).toBeDefined();
    expect(
      screen.getByText("Episode 7 — Credited on this episode only")
    ).toBeDefined();
    expect(screen.getByText("Episode 8 — Not credited")).toBeDefined();
    expect(screen.getByText("Episode 9 — Already credited")).toBeDefined();
  });

  it("says nothing changed when every selected episode was skipped", () => {
    render({
      changedEpisodePublicIds: [],
      ok: true,
      unchangedEpisodes: [
        { episodePublicId: "EP01", reason: "already_credited" },
      ],
    });

    expect(screen.getByText("No episodes were changed.")).toBeDefined();
    expect(screen.queryByText("Changed 0 episodes")).toBeNull();
    expect(screen.getByText("Episode 1 — Already credited")).toBeDefined();
  });
});
