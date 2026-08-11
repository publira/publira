// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CursorPageEmptyState } from "./cursor-page-empty-state";

afterEach(() => {
  cleanup();
});

describe("CursorPageEmptyState", () => {
  it("ページ送りが無ければ未登録として案内し、新規作成の導線も出す", () => {
    render(
      <CursorPageEmptyState
        actions={<button type="button">エピソードを新規作成</button>}
        description="まだエピソードがありません。"
        hasPageLinks={false}
        itemLabel="エピソード"
        title="このシリーズのエピソードは未登録です。"
      />
    );

    expect(
      screen.getByText("このシリーズのエピソードは未登録です。")
    ).toBeDefined();
    expect(screen.getByRole("button")).toBeDefined();
  });

  it("ページ送りがあれば一覧全体が空だとは案内しない", () => {
    render(
      <CursorPageEmptyState
        actions={<button type="button">エピソードを新規作成</button>}
        description="まだエピソードがありません。"
        hasPageLinks
        itemLabel="エピソード"
        title="このシリーズのエピソードは未登録です。"
      />
    );

    expect(
      screen.getByText("このページに表示できるエピソードはありません。")
    ).toBeDefined();
    // このページの行が消えただけなので、次の一手は新規作成ではなくページ送り。
    expect(screen.queryByRole("button")).toBeNull();
  });
});
