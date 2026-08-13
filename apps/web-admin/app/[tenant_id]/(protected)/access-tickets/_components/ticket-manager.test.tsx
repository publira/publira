// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AccessTicketItem } from "../ticket-types";
import { TicketManager } from "./ticket-manager";

vi.mock("next/link", () => ({
  default: ({ children, href }: React.ComponentProps<"a">) => (
    <a href={href}>{children}</a>
  ),
}));

// 失効ボタンは Server Action と useRouter を抱えたクライアント側の部品なので、
// ここでは一覧が行ごとに描画していることだけを見る。
vi.mock("./revoke-ticket-button", () => ({
  RevokeTicketButton: ({ publicId }: { publicId: string }) => (
    <button type="button">{`失効 ${publicId}`}</button>
  ),
}));

const ticket = (publicId: string): AccessTicketItem => ({
  createdAt: "2026-06-01T00:00:00Z",
  episodePublicId: "EPISODE001",
  episodeTitle: "第1話",
  expiresAt: "",
  note: "",
  publicId,
  revokedAt: "",
  seriesPublicId: "SERIES001",
  seriesTitle: "シリーズ",
  status: "active",
  userEmail: "reader@example.com",
  userName: "Reader",
  userPublicId: "USER001",
});

afterEach(() => {
  cleanup();
});

describe("TicketManager", () => {
  it("最初のページが空なら未登録として案内する", () => {
    render(<TicketManager pageSize={20} tickets={[]} timeZone="Asia/Tokyo" />);

    expect(screen.getByText("チケットがまだありません。")).toBeDefined();
    expect(
      screen.queryByLabelText("アクセスチケット一覧のページ送り")
    ).toBeNull();
  });

  it("ページ送りの先が空でも一覧全体が空だとは案内しない", () => {
    render(
      <TicketManager
        pageSize={20}
        previousHref="?token=previous"
        tickets={[]}
        timeZone="Asia/Tokyo"
      />
    );

    expect(
      screen.getByText("このページに表示できるチケットはありません。")
    ).toBeDefined();
    // 復旧用のリンクは残す。ここを隠すと一覧へ戻る手段が無くなる。
    const previous = screen.getByRole("link", { name: "前へ" });
    expect(previous.getAttribute("href")).toBe("?token=previous");
    expect(screen.queryByRole("link", { name: "次へ" })).toBeNull();
  });

  it("後続ページでも行ごとの操作とページ送りを描画する", () => {
    render(
      <TicketManager
        nextHref="?token=next"
        pageSize={20}
        previousHref="?token=previous"
        tickets={[ticket("TICKET001")]}
        timeZone="Asia/Tokyo"
      />
    );

    expect(screen.getByText("失効 TICKET001")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "前へ" }).getAttribute("href")
    ).toBe("?token=previous");
    expect(
      screen.getByRole("link", { name: "次へ" }).getAttribute("href")
    ).toBe("?token=next");
  });

  it("取得失敗時はエラーだけを出し、空一覧としては案内しない", () => {
    render(
      <TicketManager
        listErrorMessage="チケット一覧を取得できませんでした。"
        nextHref="?token=next"
        pageSize={20}
        previousHref="?token=previous"
        tickets={[]}
        timeZone="Asia/Tokyo"
      />
    );

    // 取得失敗はセクションの失敗なので、他画面と同じ `SectionError`
    // （role="alert" と「〇〇一覧を表示できませんでした」）で出す。
    const sectionError = screen.getByRole("alert");
    expect(sectionError.textContent).toContain(
      "アクセスチケット一覧を表示できませんでした"
    );
    expect(sectionError.textContent).toContain(
      "チケット一覧を取得できませんでした。"
    );
    expect(screen.queryByText("チケットがまだありません。")).toBeNull();
    expect(
      screen.queryByText("このページに表示できるチケットはありません。")
    ).toBeNull();
    expect(
      screen.queryByLabelText("アクセスチケット一覧のページ送り")
    ).toBeNull();
  });
});
