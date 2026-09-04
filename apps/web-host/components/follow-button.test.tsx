// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FollowButton,
  FollowControlSkeleton,
  FollowLoginLink,
} from "./follow-button";

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

vi.mock("#lib/follow-actions", () => ({
  toggleFollowAction: vi.fn(),
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const copy = (targetName: string) => ({
  follow: "Follow",
  followAriaLabel: `Follow ${targetName}`,
  pending: "Updating…",
  unfollow: "Unfollow",
  unfollowAriaLabel: `Unfollow ${targetName}`,
});

afterEach(() => {
  cleanup();
});

describe("FollowLoginLink", () => {
  it("Return to current details page Guide to login with returnTo", () => {
    render(
      <FollowLoginLink
        ariaLabel="Sign in to follow Published Series"
        href="/login?returnTo=%2Fseries%2FSERIES01"
        label="Follow"
      />
    );

    const link = screen.getByRole("link", {
      name: "Sign in to follow Published Series",
    });
    expect(link.getAttribute("href")).toBe(
      "/login?returnTo=%2Fseries%2FSERIES01"
    );
  });
});

describe("FollowButton", () => {
  it("If you are not following, issue a follow operation.", () => {
    render(
      <FollowButton
        copy={copy("Published Series")}
        isFollowing={false}
        publicId="SERIES01"
        returnTo="/series/SERIES01"
        targetKind="series"
        tenantId={tenantId}
      />
    );

    expect(
      screen.getByRole("button", { name: "Follow Published Series" })
    ).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("If you are following, issue an unsubscribe operation", () => {
    render(
      <FollowButton
        copy={copy("Published Author")}
        isFollowing
        publicId="AUTHOR01"
        returnTo="/authors/AUTHOR01"
        targetKind="author"
        tenantId={tenantId}
      />
    );

    const button = screen.getByRole("button", {
      name: "Unfollow Published Author",
    });
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("FollowControlSkeleton", () => {
  it("Display a placeholder the size of a button", () => {
    const { container } = render(<FollowControlSkeleton />);
    expect(container.querySelector("[aria-hidden='true']")).toBeTruthy();
  });
});
