// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SectionError } from "./section-error";

describe("SectionError", () => {
  it("alert role で見出しと説明を表示する", () => {
    render(
      <SectionError
        description="この操作を行う権限がありません。"
        title="オペレーター一覧を表示できませんでした"
      />
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(
      screen.getByText("オペレーター一覧を表示できませんでした")
    ).toBeTruthy();
    expect(screen.getByText("この操作を行う権限がありません。")).toBeTruthy();
  });

  it("digest を渡したときだけエラー ID を表示する", () => {
    const { rerender } = render(<SectionError title="読み込めませんでした" />);

    expect(screen.queryByText("2870412426")).toBeNull();

    rerender(<SectionError digest="2870412426" title="読み込めませんでした" />);

    expect(screen.getByText("2870412426")).toBeTruthy();
  });

  it("actions をそのまま描画する", () => {
    render(
      <SectionError
        actions={<button type="button">再試行</button>}
        title="読み込めませんでした"
      />
    );

    expect(screen.getByRole("button", { name: "再試行" })).toBeTruthy();
  });
});
