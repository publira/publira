// @vitest-environment jsdom

import * as ActionForm from "@publira/ui-components/action-form";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as FollowButton from "./follow-button";

vi.mock("#components/locale-context", () => ({
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
  <FollowButton.Root
    isFollowing={isFollowing}
    targetId="SERIES01-ID"
    returnTo="/series/SERIES01"
    targetKind="series"
    tenantId={tenantId}
  >
    <FollowButton.Follow aria-label="Follow Published Series">
      <ActionForm.Idle>Follow</ActionForm.Idle>
      <ActionForm.Pending>Updating…</ActionForm.Pending>
    </FollowButton.Follow>
    <FollowButton.Unfollow aria-label="Unfollow Published Series">
      <ActionForm.Idle>Unfollow</ActionForm.Idle>
      <ActionForm.Pending>Updating…</ActionForm.Pending>
    </FollowButton.Unfollow>
  </FollowButton.Root>
);

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
    expect(formData.get("targetId")).toBe("SERIES01-ID");
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
