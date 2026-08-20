// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleForm } from "./locale-form";

const options = [
  { label: "日本語", locale: "ja" as const },
  { label: "英語", locale: "en" as const },
];

const renderForm = (currentLocale: "en" | "ja" = "ja") =>
  render(
    <LocaleForm
      action={vi.fn()}
      currentLocale={currentLocale}
      description="この管理画面の表示言語です。"
      label="表示言語"
      options={options}
    />
  );

afterEach(() => {
  cleanup();
  document.documentElement.lang = "ja";
});

describe("LocaleForm", () => {
  it("submits the chosen locale under the locale field", () => {
    renderForm();

    const japanese = screen.getByRole("button", { name: "日本語" });
    const english = screen.getByRole("button", { name: "英語" });

    expect(japanese).toHaveProperty("name", "locale");
    expect(japanese).toHaveProperty("value", "ja");
    expect(english).toHaveProperty("value", "en");
    expect(japanese).toHaveProperty("type", "submit");
  });

  it("marks the active locale for assistive technology", () => {
    renderForm("en");

    expect(
      screen.getByRole("button", { name: "英語" }).getAttribute("aria-current")
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "日本語" })
        .getAttribute("aria-current")
    ).toBeNull();
  });

  it("updates <html lang> on click, which the Action's re-render cannot do", () => {
    renderForm();

    screen.getByRole("button", { name: "英語" }).click();

    expect(document.documentElement.lang).toBe("en");
  });
});
