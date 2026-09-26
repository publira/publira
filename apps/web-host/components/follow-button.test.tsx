// @vitest-environment jsdom

import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FollowButton,
  FollowControlSkeleton,
  FollowLoginLink,
} from "./follow-button";
import {
  FollowButtonFollow,
  FollowButtonUnfollow,
} from "./follow-button-state";

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

const { toggleFollowAction } = vi.hoisted(() => ({
  toggleFollowAction: vi.fn(),
}));

vi.mock("#lib/follow-actions", () => ({
  toggleFollowAction,
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

afterEach(() => {
  cleanup();
  toggleFollowAction.mockReset();
});

const SeriesFollowButton = ({ isFollowing }: { isFollowing: boolean }) => (
  <FollowButton
    isFollowing={isFollowing}
    publicId="SERIES01"
    returnTo="/series/SERIES01"
    targetKind="series"
    tenantId={tenantId}
  >
    <FollowButtonFollow aria-label="Follow Published Series">
      <ActionFormIdle>Follow</ActionFormIdle>
      <ActionFormPending>Updating…</ActionFormPending>
    </FollowButtonFollow>
    <FollowButtonUnfollow aria-label="Unfollow Published Series">
      <ActionFormIdle>Unfollow</ActionFormIdle>
      <ActionFormPending>Updating…</ActionFormPending>
    </FollowButtonUnfollow>
  </FollowButton>
);

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

describe("FollowButton", () => {
  it("offers to follow while the reader does not follow yet", () => {
    render(<SeriesFollowButton isFollowing={false} />);

    const button = screen.getByRole("button", {
      name: "Follow Published Series",
    });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.textContent).toBe("Follow");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers to unfollow while the reader follows", () => {
    render(<SeriesFollowButton isFollowing />);

    const button = screen.getByRole("button", {
      name: "Unfollow Published Series",
    });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.textContent).toBe("Unfollow");
  });

  it("sends the intent the reader's state calls for, then turns into the other control", async () => {
    toggleFollowAction.mockResolvedValue({
      isFollowing: true,
      message: "You are now following this series.",
      ok: true,
    });

    render(<SeriesFollowButton isFollowing={false} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Follow Published Series" })
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Unfollow Published Series" })
      ).toBeTruthy();
    });
    const formData: FormData = toggleFollowAction.mock.calls[0]?.[1];
    expect(formData.get("intent")).toBe("follow");
    expect(formData.get("publicId")).toBe("SERIES01");
    expect(screen.getByText("You are now following this series.")).toBeTruthy();
    expect(screen.getByDisplayValue("unfollow").getAttribute("name")).toBe(
      "intent"
    );
  });

  it("keeps the control it had when the Action refuses", async () => {
    toggleFollowAction.mockResolvedValue({
      message: "Could not follow.",
      ok: false,
    });

    render(<SeriesFollowButton isFollowing={false} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Follow Published Series" })
    );

    await waitFor(() => {
      expect(screen.getByText("Could not follow.")).toBeTruthy();
    });
    expect(
      screen.getByRole("button", { name: "Follow Published Series" })
    ).toBeTruthy();
  });
});

describe("FollowControlSkeleton", () => {
  it("draws a placeholder the size of a button", () => {
    const { container } = render(<FollowControlSkeleton />);
    expect(container.querySelector("[aria-hidden='true']")).toBeTruthy();
  });
});
