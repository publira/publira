// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UnfollowButton } from "./unfollow-button";

vi.mock("#components/locale-provider", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "en",
}));

vi.mock("#lib/follow-actions", () => ({
  toggleFollowAction: vi.fn(),
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

afterEach(() => {
  cleanup();
});

describe("UnfollowButton", () => {
  it("Displays only the release operation from the list", () => {
    render(
      <UnfollowButton
        copy={{
          ariaLabel: "Unfollow Published Series",
          pending: "Updating…",
          submit: "Unfollow",
        }}
        publicId="SERIES01"
        returnTo="/settings/follows"
        targetKind="series"
        tenantId={tenantId}
      />
    );

    expect(
      screen.getByRole("button", {
        name: "Unfollow Published Series",
      })
    ).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Follow Published Series" })
    ).toBeNull();
  });
});
