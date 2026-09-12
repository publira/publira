// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EpisodeReactionButton,
  EpisodeReactionControlSkeleton,
  EpisodeReactionLoginLink,
} from "./episode-reaction-button";

vi.mock("#components/locale-provider", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "en",
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const { rateEpisodeAction } = vi.hoisted(() => ({
  rateEpisodeAction: vi.fn(() => {
    const { promise } = Promise.withResolvers<never>();
    return promise;
  }),
}));

vi.mock("#lib/episode-rating-actions", () => ({
  rateEpisodeAction,
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const copy = {
  countAria: "Readers who reacted: {$count}",
  loginAria: "Sign in to react to this episode",
  maxAria: "You have reacted to this episode",
  pressAria: "React to this episode",
  pressProgressAria: "React to this episode, {$score} of {$max}",
};

afterEach(() => {
  cleanup();
  rateEpisodeAction.mockClear();
});

describe("EpisodeReactionLoginLink", () => {
  it("sends a guest to login with returnTo, showing the public headcount", () => {
    render(
      <EpisodeReactionLoginLink
        copy={copy}
        href="/login?returnTo=%2Fseries%2FSERIES01%2Fepisodes%2FEPISODE01"
        ratingCount={12}
      />
    );

    const link = screen.getByRole("link", {
      name: "Sign in to react to this episode. Readers who reacted: 12",
    });
    expect(link.getAttribute("href")).toBe(
      "/login?returnTo=%2Fseries%2FSERIES01%2Fepisodes%2FEPISODE01"
    );
    expect(link.textContent).toContain("12");
  });
});

describe("EpisodeReactionButton", () => {
  it("names a first press in single mode, then fills the control and counts the reader once", async () => {
    render(
      <EpisodeReactionButton
        copy={copy}
        episodePublicId="EPISODE01"
        mode="single"
        ratingCount={3}
        returnTo="/series/SERIES01/episodes/EPISODE01"
        score={0}
        seriesPublicId="SERIES01"
        tenantId={tenantId}
      />
    );

    const button = screen.getByRole("button", {
      name: "React to this episode. Readers who reacted: 3",
    });
    fireEvent.click(button);

    expect(
      screen.getByRole("button", {
        name: "You have reacted to this episode. Readers who reacted: 4",
      })
    ).toBeDefined();
    await Promise.resolve();
    expect(rateEpisodeAction).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", {
        name: "You have reacted to this episode. Readers who reacted: 4",
      })
    );
    await Promise.resolve();
    expect(rateEpisodeAction).toHaveBeenCalledTimes(1);
  });

  it("takes five presses to the ceiling in multiple mode and counts the reader once", async () => {
    render(
      <EpisodeReactionButton
        copy={copy}
        episodePublicId="EPISODE01"
        mode="multiple"
        ratingCount={10}
        returnTo="/series/SERIES01/episodes/EPISODE01"
        score={0}
        seriesPublicId="SERIES01"
        tenantId={tenantId}
      />
    );

    fireEvent.click(screen.getByRole("button"));
    expect(
      screen.getByRole("button", {
        name: "React to this episode, 1 of 5. Readers who reacted: 11",
      })
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));

    expect(
      screen.getByRole("button", {
        name: "You have reacted to this episode. Readers who reacted: 11",
      })
    ).toBeDefined();

    await Promise.resolve();
    expect(rateEpisodeAction).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button"));
    await Promise.resolve();
    expect(rateEpisodeAction).toHaveBeenCalledTimes(1);
  });
});

describe("EpisodeReactionControlSkeleton", () => {
  it("renders a placeholder the size of the control", () => {
    const { container } = render(<EpisodeReactionControlSkeleton />);
    expect(container.querySelector("[aria-hidden='true']")).toBeTruthy();
  });
});
