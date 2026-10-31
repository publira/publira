// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FollowControlSkeleton, FollowLoginLink } from "./follow-control";

// `getLocale()` is a root-parameter read that only the Next.js compiler can
// provide, and neither the link nor the skeleton reads it.
vi.mock("#lib/locale", () => ({
  getLocale: () => Promise.resolve("en"),
}));

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

describe("FollowLoginLink", () => {
  it("sends a guest to login with returnTo", () => {
    render(
      <FollowLoginLink
        aria-label="Sign in to follow Published Series"
        href="/login?returnTo=%2Fseries%2FSERIES01"
      >
        Follow
      </FollowLoginLink>
    );

    const link = screen.getByRole("link", {
      name: "Sign in to follow Published Series",
    });

    expect(link.getAttribute("href")).toBe(
      "/login?returnTo=%2Fseries%2FSERIES01"
    );
    expect(link.textContent).toBe("Follow");
  });
});

describe("FollowControlSkeleton", () => {
  it("draws a placeholder the size of a button", () => {
    const { container } = render(<FollowControlSkeleton />);
    expect(container.querySelector("[aria-hidden='true']")).toBeTruthy();
  });
});
