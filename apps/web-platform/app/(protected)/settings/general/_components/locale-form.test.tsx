// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Component } from "react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleForm } from "./locale-form";

/**
 * A rejected form Action is surfaced by React to the nearest error boundary —
 * `SectionErrorBoundary` in the console. Without one here the rejection leaves
 * the test runner as an uncaught exception, so the rejection case renders
 * behind this stand-in.
 */
class TestErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const options = [
  { label: "日本語", locale: "ja" as const },
  { label: "英語", locale: "en" as const },
];

const renderForm = (
  action: (formData: FormData) => Promise<void>,
  currentLocale: "en" | "ja" = "ja"
) =>
  render(
    <TestErrorBoundary>
      <LocaleForm
        action={action}
        currentLocale={currentLocale}
        description="この管理画面の表示言語です。"
        label="表示言語"
        options={options}
      />
    </TestErrorBoundary>
  );

afterEach(() => {
  cleanup();
  document.documentElement.lang = "ja";
});

describe("LocaleForm", () => {
  it("submits the chosen locale under the locale field", () => {
    renderForm(vi.fn());

    const japanese = screen.getByRole("button", { name: "日本語" });
    const english = screen.getByRole("button", { name: "英語" });

    expect(japanese).toHaveProperty("name", "locale");
    expect(japanese).toHaveProperty("value", "ja");
    expect(english).toHaveProperty("value", "en");
    expect(japanese).toHaveProperty("type", "submit");
  });

  it("marks the active locale for assistive technology", () => {
    renderForm(vi.fn(), "en");

    expect(
      screen.getByRole("button", { name: "英語" }).getAttribute("aria-current")
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "日本語" })
        .getAttribute("aria-current")
    ).toBeNull();
  });

  it("updates <html lang> once the Action resolved, which its re-render cannot do", async () => {
    const action = vi.fn<(formData: FormData) => Promise<void>>(() =>
      Promise.resolve()
    );
    renderForm(action);

    screen.getByRole("button", { name: "英語" }).click();

    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(document.documentElement.lang).toBe("en");
    });
    expect(action.mock.calls[0]?.[0]?.get("locale")).toBe("en");
  });

  it("leaves <html lang> alone when the Action rejects", async () => {
    // The cookie was not written and the copy on screen did not change, so the
    // document must not start claiming the locale that failed to apply.
    const action = vi.fn(() => Promise.reject(new Error("network")));
    renderForm(action);

    screen.getByRole("button", { name: "英語" }).click();

    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
    });
    expect(document.documentElement.lang).toBe("ja");
  });
});
