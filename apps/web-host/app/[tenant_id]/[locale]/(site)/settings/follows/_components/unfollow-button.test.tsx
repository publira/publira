// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UnfollowButton } from "./unfollow-button";

vi.mock("#lib/follow-actions", () => ({
  toggleFollowAction: vi.fn(),
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

afterEach(() => {
  cleanup();
});

describe("UnfollowButton", () => {
  it("一覧からの解除操作だけを出す", () => {
    render(
      <UnfollowButton
        copy={{
          ariaLabel: "「公開シリーズ」のフォローを解除する",
          pending: "更新中…",
          submit: "フォローを解除",
        }}
        publicId="SERIES01"
        returnTo="/settings/follows"
        targetKind="series"
        tenantId={tenantId}
      />
    );

    expect(
      screen.getByRole("button", {
        name: "「公開シリーズ」のフォローを解除する",
      })
    ).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "「公開シリーズ」をフォローする" })
    ).toBeNull();
  });
});
