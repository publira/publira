// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithClientMessages } from "#lib/render-with-client-messages";

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
  it("Displays only the release operation from the list", async () => {
    await renderWithClientMessages(
      <UnfollowButton
        publicId="SERIES01"
        returnTo="/settings/follows"
        targetKind="series"
        targetName="Published Series"
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
