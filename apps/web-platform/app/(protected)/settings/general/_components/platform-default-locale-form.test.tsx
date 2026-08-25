// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlatformDefaultLocaleForm } from "./platform-default-locale-form";

const noopAction = vi.fn();

const options = [
  { label: "日本語", locale: "ja" as const },
  { label: "英語", locale: "en" as const },
];

afterEach(() => {
  cleanup();
});

describe("PlatformDefaultLocaleForm", () => {
  it("保存済みの既定言語を選択済みとして表示する", () => {
    render(
      <PlatformDefaultLocaleForm
        action={noopAction}
        initialDefaultLocale="en"
        options={options}
      />
    );

    const trigger = screen.getByLabelText("既定言語");

    expect(trigger.textContent).toContain("英語");
    expect(trigger).toHaveProperty("disabled", false);
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "既定言語を保存",
      }).disabled
    ).toBe(false);
  });

  it("取得に失敗した場合は編集できず理由を出す", () => {
    render(
      <PlatformDefaultLocaleForm
        action={noopAction}
        initialDefaultLocale="ja"
        loadErrorMessage="プラットフォーム設定の取得に失敗しました。"
        options={options}
      />
    );

    expect(screen.getByLabelText("既定言語")).toHaveProperty("disabled", true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "既定言語を保存",
      }).disabled
    ).toBe(true);
    expect(
      screen.getByText(/プラットフォーム設定の取得に失敗しました。/u)
    ).toBeDefined();
    expect(
      screen.getByText(/保存すると現在の設定を上書きしてしまうため/u)
    ).toBeDefined();
  });
});
