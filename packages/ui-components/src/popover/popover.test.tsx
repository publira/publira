// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "./popover";

describe("Popover", () => {
  it("shows its content in a Portal on the shared surface, and Escape returns to the trigger", () => {
    render(
      <Popover>
        <PopoverTrigger>Choose a language</PopoverTrigger>
        <PopoverContent align="end" className="w-48" sideOffset={8}>
          <PopoverTitle>Language</PopoverTitle>
          <button type="button">English</button>
        </PopoverContent>
      </Popover>
    );

    const trigger = screen.getByRole("button", { name: "Choose a language" });
    trigger.focus();
    fireEvent.click(trigger);

    const content = screen.getByRole("dialog", { name: "Language" });
    expect(content.className).toContain("max-w-[calc(100vw-2rem)]");
    expect(content.className).toContain("border-border");
    expect(content.className).toContain("w-48");

    fireEvent.keyDown(content, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
