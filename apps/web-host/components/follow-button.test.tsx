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

const copy = (targetName: string) => ({
  follow: "フォローする",
  followAriaLabel: `「${targetName}」をフォローする`,
  pending: "更新中…",
  unfollow: "フォローを解除",
  unfollowAriaLabel: `「${targetName}」のフォローを解除する`,
});

afterEach(() => {
  cleanup();
});

describe("FollowLoginLink", () => {
  it("現在の詳細ページへ戻る returnTo 付きでログインへ誘導する", () => {
    render(
      <FollowLoginLink
        ariaLabel="ログインして「公開シリーズ」をフォローする"
        href="/login?returnTo=%2Fseries%2FSERIES01"
        label="フォローする"
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
        copy={copy("公開シリーズ")}
        isFollowing={false}
        publicId="SERIES01"
        returnTo="/series/SERIES01"
        targetKind="series"
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
        copy={copy("公開著者")}
        isFollowing
        publicId="AUTHOR01"
        returnTo="/authors/AUTHOR01"
        targetKind="author"
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
