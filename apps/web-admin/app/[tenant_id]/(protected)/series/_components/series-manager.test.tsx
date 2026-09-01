// @vitest-environment jsdom

import { getMessage } from "@publira/i18n";
import type { MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SeriesManager } from "./series-manager";

vi.mock("#components/message", () => ({
  Message: ({ message, values }: { message: string; values?: MessageValues }) =>
    getMessage(sharedCatalog("ja"), message, values),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: React.ComponentProps<"a">) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("SeriesManager", () => {
  it("says nothing is registered yet when the first page is empty", () => {
    render(
      <SeriesManager
        locale="ja"
        pageSize={20}
        series={[]}
        timeZone="Asia/Tokyo"
      />
    );

    expect(
      screen.getByText("シリーズがまだ登録されていません。")
    ).toBeDefined();
    expect(screen.queryByLabelText("シリーズ一覧のページ送り")).toBeNull();
  });

  it("does not say the whole list is empty when a later page is empty", () => {
    render(
      <SeriesManager
        locale="ja"
        pageSize={20}
        previousHref="?token=previous"
        series={[]}
        timeZone="Asia/Tokyo"
      />
    );

    expect(
      screen.getByText("このページに表示できるシリーズはありません。")
    ).toBeDefined();
    // 復旧用のリンクは残す。ここを隠すと一覧へ戻る手段が無くなる。
    expect(screen.getByLabelText("シリーズ一覧のページ送り")).toBeDefined();
  });

  it("shows only the error and does not call the list empty when the fetch fails", () => {
    render(
      <SeriesManager
        listErrorMessage="シリーズ一覧を取得できませんでした。"
        locale="ja"
        nextHref="?token=next"
        pageSize={20}
        previousHref="?token=previous"
        series={[]}
        timeZone="Asia/Tokyo"
      />
    );

    // 取得失敗はセクションの失敗なので、他画面と同じ `SectionError`
    // （role="alert" と「〇〇一覧を表示できませんでした」）で出す。
    const sectionError = screen.getByRole("alert");
    expect(sectionError.textContent).toContain(
      "シリーズ一覧を表示できませんでした"
    );
    expect(sectionError.textContent).toContain(
      "シリーズ一覧を取得できませんでした。"
    );
    expect(screen.queryByText("シリーズがまだ登録されていません。")).toBeNull();
    expect(
      screen.queryByText("このページに表示できるシリーズはありません。")
    ).toBeNull();
    expect(screen.queryByLabelText("シリーズ一覧のページ送り")).toBeNull();
  });
});
