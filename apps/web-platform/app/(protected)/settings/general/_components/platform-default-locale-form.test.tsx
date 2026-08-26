// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ja from "../../../../../../../locales/ja.json";
import { PlatformDefaultLocaleForm } from "./platform-default-locale-form";

const messages = {
  "platform.settings.default_locale_description":
    "新規に作成するテナントの初期言語です。",
  "platform.settings.default_locale_help": "日本語または英語を選べます。",
  "platform.settings.default_locale_label": "既定言語",
  "platform.settings.default_locale_reload":
    "保存すると現在の設定を上書きしてしまうため、再読み込みしてから変更してください。",
  "platform.settings.default_locale_save": "既定言語を保存",
  "platform.settings.default_locale_title": "既定言語",
} as const;

vi.mock("#components/message", () => ({
  Message: ({ message }: { message: keyof typeof messages }) =>
    messages[message],
}));

vi.mock("#lib/locale", () => ({
  getPlatformLocale: () => Promise.resolve("ja"),
  loadPlatformMessages: () => Promise.resolve(ja),
}));

afterEach(() => {
  cleanup();
});

describe("PlatformDefaultLocaleForm", () => {
  it("保存済みの既定言語を選択済みとして表示する", async () => {
    render(
      await PlatformDefaultLocaleForm({
        initialDefaultLocale: "en",
      })
    );

    const trigger = screen.getByLabelText("既定言語");

    expect(trigger.textContent).toContain("English");
    expect(trigger).toHaveProperty("disabled", false);
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "既定言語を保存",
      }).disabled
    ).toBe(false);
  });

  it("取得に失敗した場合は編集できず理由を出す", async () => {
    render(
      await PlatformDefaultLocaleForm({
        initialDefaultLocale: "ja",
        loadErrorMessage: "プラットフォーム設定の取得に失敗しました。",
      })
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
