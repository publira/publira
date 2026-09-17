// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithClientMessages } from "#lib/render-with-client-messages";

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

afterEach(() => {
  cleanup();
});

describe("FollowLoginLink", () => {
  it("Return to current details page Guide to login with returnTo", async () => {
    await renderWithClientMessages(
      <FollowLoginLink
        href="/login?returnTo=%2Fseries%2FSERIES01"
        targetName="Published Series"
      />
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

describe("FollowButton", () => {
  it("If you are not following, issue a follow operation.", async () => {
    await renderWithClientMessages(
      <FollowButton
        isFollowing={false}
        publicId="SERIES01"
        returnTo="/series/SERIES01"
        targetKind="series"
        targetName="Published Series"
        tenantId={tenantId}
      />
    );

    const button = screen.getByRole("button", {
      name: "Follow Published Series",
    });
    expect(button.textContent).toBe("Follow");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("If you are following, issue an unsubscribe operation", async () => {
    await renderWithClientMessages(
      <FollowButton
        isFollowing
        publicId="CREATOR01"
        returnTo="/creators/CREATOR01"
        targetKind="creator"
        targetName="Published Creator"
        tenantId={tenantId}
      />
    );

    const button = screen.getByRole("button", {
      name: "Unfollow Published Creator",
    });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.textContent).toBe("Unfollow");
  });
});

describe("FollowControlSkeleton", () => {
  it("Display a placeholder the size of a button", () => {
    const { container } = render(<FollowControlSkeleton />);
    expect(container.querySelector("[aria-hidden='true']")).toBeTruthy();
  });
});
