// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as EpisodeReaction from "./episode-reaction";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("#components/locale-context", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "en",
}));

vi.mock("./client-message", () => ({
  useClientMessages: () => bindMessages(sharedCatalog("en"), "en"),
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

const GuestReaction = ({
  href,
  ratingCount,
}: {
  href: string;
  ratingCount: number;
}) => (
  <EpisodeReaction.Root>
    <EpisodeReaction.Login href={href} ratingCount={ratingCount}>
      <EpisodeReaction.Name>
        <EpisodeReaction.NameIdle>
          Sign in to react to this episode
        </EpisodeReaction.NameIdle>
        <EpisodeReaction.NameReaders message="storefront.episode.reaction.count_aria" />
      </EpisodeReaction.Name>
      <EpisodeReaction.Heart />
      <EpisodeReaction.Count />
    </EpisodeReaction.Login>
  </EpisodeReaction.Root>
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
  <EpisodeReaction.Root>
    <EpisodeReaction.Form mode={mode} ratingCount={ratingCount} score={score}>
      <EpisodeReaction.Submit>
        <EpisodeReaction.Name>
          <EpisodeReaction.NameIdle>
            React to this episode
          </EpisodeReaction.NameIdle>
          <EpisodeReaction.NameProgress message="storefront.episode.reaction.press_progress_aria" />
          <EpisodeReaction.NameDone>
            You have reacted to this episode
          </EpisodeReaction.NameDone>
          <EpisodeReaction.NameReaders message="storefront.episode.reaction.count_aria" />
        </EpisodeReaction.Name>
        <EpisodeReaction.Heart />
        <EpisodeReaction.Count />
      </EpisodeReaction.Submit>
    </EpisodeReaction.Form>
  </EpisodeReaction.Root>
);

afterEach(() => {
  cleanup();
  rateEpisodeAction.mockClear();
});

describe("EpisodeReaction.Login", () => {
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

describe("EpisodeReaction.Heart", () => {
  it("draws an empty heart until a fill is given", () => {
    const { container } = render(<EpisodeReaction.Heart />);
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });

  it("fills the heart by the given ratio", () => {
    const { container } = render(<EpisodeReaction.Heart fillRatio={0.4} />);
    expect(container.querySelectorAll("svg")).toHaveLength(2);
    expect(container.querySelector("[style]")?.getAttribute("style")).toContain(
      "inset(60%"
    );
  });
});

describe("EpisodeReaction.Skeleton", () => {
  it("renders a placeholder the size of the control", () => {
    const { container } = render(<EpisodeReaction.Skeleton />);
    expect(container.querySelector("[aria-hidden='true']")).toBeTruthy();
  });
});

describe("EpisodeReaction.Form", () => {
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
