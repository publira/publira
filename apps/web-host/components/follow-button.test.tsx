// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FollowButton,
  FollowControlSkeleton,
  FollowLoginLink,
} from "./follow-button";

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
  it("現在の詳細ページへ戻る returnTo 付きでログインへ誘導する", () => {
    render(
      <FollowLoginLink
        href="/login?returnTo=%2Fseries%2FSERIES01"
        targetName="公開シリーズ"
      />
    );

    const link = screen.getByRole("link", {
      name: "ログインして「公開シリーズ」をフォローする",
    });
    expect(link.getAttribute("href")).toBe(
      "/login?returnTo=%2Fseries%2FSERIES01"
    );
  });
});

describe("FollowButton", () => {
  it("未フォローならフォロー操作を出す", () => {
    render(
      <FollowButton
        isFollowing={false}
        publicId="SERIES01"
        returnTo="/series/SERIES01"
        targetKind="series"
        targetName="公開シリーズ"
        tenantId={tenantId}
      />
    );

    expect(
      screen.getByRole("button", { name: "「公開シリーズ」をフォローする" })
    ).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("フォロー中なら解除操作を出す", () => {
    render(
      <FollowButton
        isFollowing
        publicId="AUTHOR01"
        returnTo="/authors/AUTHOR01"
        targetKind="author"
        targetName="公開著者"
        tenantId={tenantId}
      />
    );

    const button = screen.getByRole("button", {
      name: "「公開著者」のフォローを解除する",
    });
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("FollowControlSkeleton", () => {
  it("ボタン相当の大きさのプレースホルダを出す", () => {
    const { container } = render(<FollowControlSkeleton />);
    expect(container.querySelector("[aria-hidden='true']")).toBeTruthy();
  });
});
