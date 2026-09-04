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

// Each option carries the language's own name, so the ja one is written in
// Japanese the way the locale registry spells it.
const options = [
  { label: "English", locale: "en" },
  { label: "日本語", locale: "ja" },
];

afterEach(() => {
  cleanup();
  document.documentElement.lang = "en";
});

describe("LocaleSwitcher", () => {
  it("the popover lists the options in their own language and marks the current one", () => {
    render(
      <LocaleSwitcher
        action={vi.fn()}
        currentLocale="en"
        fieldName="locale"
        label="Language"
        options={options}
      />
    );

    const trigger = screen.getByRole("button", {
      name: "Language: English",
    });
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "Language" })).toBeDefined();
    expect(screen.getByRole("button", { name: "English" })).toHaveProperty(
      "ariaCurrent",
      "true"
    );
    expect(screen.getByRole("button", { name: "日本語" })).toHaveProperty(
      "lang",
      "ja"
    );
  });

  it("sends the chosen language to the Action and updates html lang once it succeeds", async () => {
    const action = vi.fn<(formData: FormData) => Promise<void>>(() =>
      Promise.resolve()
    );
    render(
      <LocaleSwitcher
        action={action}
        currentLocale="en"
        fieldName="locale"
        label="Language"
        options={options}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Language: English" }));
    fireEvent.click(screen.getByRole("button", { name: "日本語" }));

    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
      expect(document.documentElement.lang).toBe("ja");
    });
    expect(action.mock.calls[0]?.[0]?.get("locale")).toBe("ja");
  });

  it("Escape closes it and returns focus to the trigger", () => {
    render(
      <LocaleSwitcher
        action={vi.fn()}
        currentLocale="en"
        fieldName="locale"
        label="Language"
        options={options}
      />
    );

    const trigger = screen.getByRole("button", {
      name: "Language: English",
    });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
