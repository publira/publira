// @vitest-environment jsdom

import { getMessage } from "@publira/i18n";
import type { MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AccessTicketItem } from "../ticket-types";
import { TicketManager } from "./ticket-manager";

vi.mock("#components/message", () => ({
  Message: ({ message, values }: { message: string; values?: MessageValues }) =>
    getMessage(sharedCatalog("ja"), message, values),
}));

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
  it("says nothing is registered yet when the first page is empty", () => {
    render(
      <TicketManager
        locale="ja"
        pageSize={20}
        tickets={[]}
        timeZone="Asia/Tokyo"
      />
    );

    expect(screen.getByText("チケットがまだありません。")).toBeDefined();
    expect(
      screen.queryByLabelText("アクセスチケット一覧のページ送り")
    ).toBeNull();
  });

  it("does not say the whole list is empty when a later page is empty", () => {
    render(
      <TicketManager
        locale="ja"
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

  it("lists the status and the note of an active ticket", () => {
    render(
      <TicketManager
        locale="ja"
        pageSize={20}
        tickets={[
          {
            ...ticket("TICKET001"),
            note: "レビュー用",
            status: "active",
          },
        ]}
        timeZone="Asia/Tokyo"
      />
    );

    expect(screen.getByText("有効")).toBeDefined();
    expect(screen.getByText("レビュー用")).toBeDefined();
    expect(screen.getByText("失効 TICKET001")).toBeDefined();
  });

  it("renders the per-row actions and the pager on a later page", () => {
    render(
      <TicketManager
        locale="ja"
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

  it("shows only the error and does not call the list empty when the fetch fails", () => {
    render(
      <TicketManager
        locale="ja"
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
