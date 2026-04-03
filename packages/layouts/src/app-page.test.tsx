// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppPage } from "./app-page";

vi.mock("@publira/utils", () => ({
  cn: (...inputs: (string | undefined)[]) => inputs.filter(Boolean).join(" "),
}));

afterEach(() => {
  cleanup();
});

describe("AppPage", () => {
  it("タイトル・説明・アクションを表示する", () => {
    render(
      <AppPage
        actions={<button type="button">保存</button>}
        description="シリーズ管理を行います"
        title="シリーズ"
      >
        <div>コンテンツ本文</div>
      </AppPage>
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "シリーズ" })
    ).toBeTruthy();
    expect(screen.getByText("シリーズ管理を行います")).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
    expect(screen.getByText("コンテンツ本文")).toBeTruthy();
  });

  it("description と actions が未指定でも表示できる", () => {
    render(<AppPage title="ダッシュボード">Body</AppPage>);

    expect(
      screen.getByRole("heading", { level: 1, name: "ダッシュボード" })
    ).toBeTruthy();
    expect(screen.getByText("Workspace")).toBeTruthy();
    expect(screen.getByText("Body")).toBeTruthy();
  });
});
