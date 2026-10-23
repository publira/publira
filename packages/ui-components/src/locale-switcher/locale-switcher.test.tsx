// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as LocaleSwitcher from ".";

// Each option carries the language's own name, so the ja one is written in
// Japanese the way the locale registry spells it.
const options = [
  { label: "English", locale: "en" },
  { label: "日本語", locale: "ja" },
];

const Switcher = ({
  action,
}: {
  action: (formData: FormData) => Promise<void>;
}) => (
  <LocaleSwitcher.Root action={action} currentLocale="en" fieldName="locale">
    <LocaleSwitcher.Trigger aria-label="Language" />
    <LocaleSwitcher.Content>
      <LocaleSwitcher.Title>Language</LocaleSwitcher.Title>
      <LocaleSwitcher.Options aria-label="Language">
        {options.map((option) => (
          <LocaleSwitcher.Option key={option.locale} locale={option.locale}>
            {option.label}
          </LocaleSwitcher.Option>
        ))}
      </LocaleSwitcher.Options>
    </LocaleSwitcher.Content>
  </LocaleSwitcher.Root>
);

afterEach(() => {
  cleanup();
  document.documentElement.lang = "en";
});

describe("LocaleSwitcher", () => {
  it("the popover lists the options in their own language and marks the current one", () => {
    render(<Switcher action={vi.fn()} />);

    const trigger = screen.getByRole("button", {
      name: "Language",
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
    render(<Switcher action={action} />);

    fireEvent.click(screen.getByRole("button", { name: "Language" }));
    fireEvent.click(screen.getByRole("button", { name: "日本語" }));

    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
      expect(document.documentElement.lang).toBe("ja");
    });
    expect(action.mock.calls[0]?.[0]?.get("locale")).toBe("ja");
  });

  it("Escape closes it and returns focus to the trigger", () => {
    render(<Switcher action={vi.fn()} />);

    const trigger = screen.getByRole("button", {
      name: "Language",
    });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
