// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleSwitcher } from "./locale-switcher";

const options = [
  { label: "English", locale: "en" },
  { label: "日本語", locale: "ja" },
];

afterEach(() => {
  cleanup();
  document.documentElement.lang = "ja";
});

describe("LocaleSwitcher", () => {
  it("母語表記の選択肢と現在の言語をポップオーバーに表示する", () => {
    render(
      <LocaleSwitcher
        action={vi.fn()}
        currentLocale="ja"
        fieldName="locale"
        label="表示言語"
        options={options}
      />
    );

    const trigger = screen.getByRole("button", {
      name: "表示言語: 日本語",
    });
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "表示言語" })).toBeDefined();
    expect(screen.getByRole("button", { name: "日本語" })).toHaveProperty(
      "ariaCurrent",
      "true"
    );
    expect(screen.getByRole("button", { name: "English" })).toHaveProperty(
      "lang",
      "en"
    );
  });

  it("選択した言語を Action に送り、成功後に html の lang を更新する", async () => {
    const action = vi.fn<(formData: FormData) => Promise<void>>(() =>
      Promise.resolve()
    );
    render(
      <LocaleSwitcher
        action={action}
        currentLocale="ja"
        fieldName="locale"
        label="表示言語"
        options={options}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "表示言語: 日本語" }));
    fireEvent.click(screen.getByRole("button", { name: "English" }));

    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
      expect(document.documentElement.lang).toBe("en");
    });
    expect(action.mock.calls[0]?.[0]?.get("locale")).toBe("en");
  });

  it("Escape で閉じ、トリガーへフォーカスを戻す", () => {
    render(
      <LocaleSwitcher
        action={vi.fn()}
        currentLocale="ja"
        fieldName="locale"
        label="表示言語"
        options={options}
      />
    );

    const trigger = screen.getByRole("button", {
      name: "表示言語: 日本語",
    });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
