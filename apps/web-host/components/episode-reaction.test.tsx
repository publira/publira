// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EpisodeReactionHeart,
  EpisodeReactionLogin,
  EpisodeReactionSkeleton,
} from "./episode-reaction";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("EpisodeReactionLogin", () => {
  it("sends a guest to login with returnTo, showing the public headcount as a child", () => {
    render(
      <EpisodeReactionLogin
        aria-label="Sign in to react to this episode. Readers who reacted: 12"
        href="/login?returnTo=%2Fseries%2FSERIES01%2Fepisodes%2FEPISODE01"
      >
        <EpisodeReactionHeart />
        12
      </EpisodeReactionLogin>
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
