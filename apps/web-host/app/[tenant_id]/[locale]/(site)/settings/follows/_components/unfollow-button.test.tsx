// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UnfollowButton } from "./unfollow-button";

vi.mock("#components/locale-provider", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "en",
}));

// `<Message>` is an async Server Component that only the Next.js compiler can
// render. The catalog is the real one, so the assertions stay on the copy a
// reader actually sees.
vi.mock("#components/message", () => ({
  Message: ({ message }: { message: MessageKey<SharedMessages> }) =>
    bindMessages(sharedCatalog("en"))(message),
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

const renderUnfollowButton = () =>
  render(
    <UnfollowButton
      aria-label="Unfollow Published Series"
      publicId="SERIES01"
      returnTo="/settings/follows"
      targetKind="series"
      tenantId={tenantId}
    />
  );

describe("UnfollowButton", () => {
  it("offers only to unfollow", () => {
    renderUnfollowButton();

    expect(
      screen.getByRole("button", { name: "Unfollow Published Series" })
        .textContent
    ).toBe("Unfollow");
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Follow Published Series" })
    ).toBeNull();
  });

  it("sends an unfollow and takes the control away once it succeeds", async () => {
    toggleFollowAction.mockResolvedValue({
      isFollowing: false,
      message: "You no longer follow this series.",
      ok: true,
    });

    renderUnfollowButton();

    fireEvent.click(
      screen.getByRole("button", { name: "Unfollow Published Series" })
    );

    await waitFor(() => {
      expect(
        screen.getByText("You no longer follow this series.")
      ).toBeTruthy();
    });
    expect(screen.queryByRole("button")).toBeNull();
    const formData: FormData = toggleFollowAction.mock.calls[0]?.[1];
    expect(formData.get("intent")).toBe("unfollow");
    expect(formData.get("publicId")).toBe("SERIES01");
    expect(formData.get("targetKind")).toBe("series");
  });

  it("keeps the control when the Action refuses", async () => {
    toggleFollowAction.mockResolvedValue({
      message: "Could not unfollow.",
      ok: false,
    });

    renderUnfollowButton();

    fireEvent.click(
      screen.getByRole("button", { name: "Unfollow Published Series" })
    );

    await waitFor(() => {
      expect(screen.getByText("Could not unfollow.")).toBeTruthy();
    });
    expect(
      screen.getByRole("button", { name: "Unfollow Published Series" })
    ).toBeTruthy();
  });
});
