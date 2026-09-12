// @vitest-environment jsdom

import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EpisodeReaction,
  EpisodeReactionCount,
  EpisodeReactionForm,
  EpisodeReactionHeart,
  EpisodeReactionLogin,
  EpisodeReactionName,
  EpisodeReactionNameDone,
  EpisodeReactionNameIdle,
  EpisodeReactionNameProgress,
  EpisodeReactionNameReaders,
  EpisodeReactionSkeleton,
  EpisodeReactionSubmit,
} from "./episode-reaction";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("#components/locale-provider", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "en",
}));

vi.mock("./client-message", () => ({
  useHostMessages: () => sharedCatalog("en"),
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

const GuestReaction = ({
  href,
  ratingCount,
}: {
  href: string;
  ratingCount: number;
}) => (
  <EpisodeReaction>
    <EpisodeReactionLogin href={href} ratingCount={ratingCount}>
      <EpisodeReactionName>
        <EpisodeReactionNameIdle>
          Sign in to react to this episode
        </EpisodeReactionNameIdle>
        <EpisodeReactionNameReaders message="host.episode.reaction.count_aria" />
      </EpisodeReactionName>
      <EpisodeReactionHeart />
      <EpisodeReactionCount />
    </EpisodeReactionLogin>
  </EpisodeReaction>
);

const SignedInReaction = ({
  mode,
  ratingCount,
  score,
}: {
  mode: "multiple" | "single";
  ratingCount: number;
  score: number;
}) => (
  <EpisodeReaction>
    <EpisodeReactionForm
      episodePublicId="EPISODE01"
      mode={mode}
      ratingCount={ratingCount}
      returnTo="/series/SERIES01/episodes/EPISODE01"
      score={score}
      seriesPublicId="SERIES01"
      tenantId={tenantId}
    >
      <EpisodeReactionSubmit>
        <EpisodeReactionName>
          <EpisodeReactionNameIdle>
            React to this episode
          </EpisodeReactionNameIdle>
          <EpisodeReactionNameProgress message="host.episode.reaction.press_progress_aria" />
          <EpisodeReactionNameDone>
            You have reacted to this episode
          </EpisodeReactionNameDone>
          <EpisodeReactionNameReaders message="host.episode.reaction.count_aria" />
        </EpisodeReactionName>
        <EpisodeReactionHeart />
        <EpisodeReactionCount />
      </EpisodeReactionSubmit>
    </EpisodeReactionForm>
  </EpisodeReaction>
);

afterEach(() => {
  cleanup();
  rateEpisodeAction.mockClear();
});

describe("EpisodeReactionLogin", () => {
  it("sends a guest to login with returnTo, showing the public headcount", () => {
    render(
      <GuestReaction
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

describe("EpisodeReactionHeart", () => {
  it("draws an empty heart until a fill is given", () => {
    const { container } = render(<EpisodeReactionHeart />);
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });

  it("fills the heart by the given ratio", () => {
    const { container } = render(<EpisodeReactionHeart fillRatio={0.4} />);
    expect(container.querySelectorAll("svg")).toHaveLength(2);
    expect(container.querySelector("[style]")?.getAttribute("style")).toContain(
      "inset(60%"
    );
  });
});

describe("EpisodeReactionSkeleton", () => {
  it("renders a placeholder the size of the control", () => {
    const { container } = render(<EpisodeReactionSkeleton />);
    expect(container.querySelector("[aria-hidden='true']")).toBeTruthy();
  });
});

describe("EpisodeReactionForm", () => {
  it("names a first press in single mode, then fills the control and counts the reader once", async () => {
    render(<SignedInReaction mode="single" ratingCount={3} score={0} />);

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
    render(<SignedInReaction mode="multiple" ratingCount={10} score={0} />);

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
