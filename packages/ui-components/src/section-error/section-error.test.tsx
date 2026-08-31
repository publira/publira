// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SectionError } from "./section-error";

describe("SectionError", () => {
  it("shows the heading and the description with the alert role", () => {
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

  it("the error ID appears only when a digest is given", () => {
    const { rerender } = render(<SectionError title="読み込めませんでした" />);

    expect(screen.queryByText("2870412426")).toBeNull();

    rerender(<SectionError digest="2870412426" title="読み込めませんでした" />);

    expect(screen.getByText("2870412426")).toBeTruthy();
  });

  it("renders actions as they are", () => {
    render(
      <SectionError
        actions={<button type="button">再試行</button>}
        title="読み込めませんでした"
      />
    );

    expect(screen.getByRole("button", { name: "再試行" })).toBeTruthy();
  });
});
