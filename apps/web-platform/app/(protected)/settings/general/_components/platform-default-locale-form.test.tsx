// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlatformDefaultLocaleForm } from "./platform-default-locale-form";
import type { PlatformDefaultLocaleFormCopy } from "./platform-default-locale-form";

const noopAction = vi.fn();

const options = [
  { label: "日本語", locale: "ja" as const },
  { label: "英語", locale: "en" as const },
];

const copy: PlatformDefaultLocaleFormCopy = {
  description:
    "新規に作成するテナントの初期言語であり、表示言語を選んでいないときにこのプラットフォーム管理画面を表示する言語にもなります。",
  fieldDescription:
    "日本語または英語を選べます。変更しても作成済みテナントの既定言語は変わりません。各テナントの既定言語はテナント管理画面から変更します。上の「表示言語」で言語を選んでいる場合、この画面の表示はそちらが優先されます。",
  label: "既定言語",
  placeholder: "言語を選択してください",
  reloadWarning:
    "保存すると現在の設定を上書きしてしまうため、再読み込みしてから変更してください。",
  saveLabel: "既定言語を保存",
  savingLabel: "保存中...",
  title: "既定言語",
};

afterEach(() => {
  cleanup();
});

describe("PlatformDefaultLocaleForm", () => {
  it("保存済みの既定言語を選択済みとして表示する", () => {
    render(
      <PlatformDefaultLocaleForm
        action={noopAction}
        copy={copy}
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
        copy={copy}
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
