// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SeriesManager } from "./series-manager";

vi.mock("next/link", () => ({
  default: ({ children, href }: React.ComponentProps<"a">) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("SeriesManager", () => {
  it("最初のページが空なら未登録として案内する", () => {
    render(<SeriesManager pageSize={20} series={[]} />);

    expect(
      screen.getByText("シリーズがまだ登録されていません。")
    ).toBeDefined();
    expect(screen.queryByLabelText("シリーズ一覧のページ送り")).toBeNull();
  });

  it("ページ送りの先が空でも一覧全体が空だとは案内しない", () => {
    render(
      <SeriesManager pageSize={20} previousHref="?token=previous" series={[]} />
    );

    expect(
      screen.getByText("このページに表示できるシリーズはありません。")
    ).toBeDefined();
    // 復旧用のリンクは残す。ここを隠すと一覧へ戻る手段が無くなる。
    expect(screen.getByLabelText("シリーズ一覧のページ送り")).toBeDefined();
  });
});
