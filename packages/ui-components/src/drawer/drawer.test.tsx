// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "./drawer";

describe("Drawer", () => {
  it("opens a sheet on the right edge named by its title, and its close control returns to the trigger", () => {
    render(
      <Drawer>
        <DrawerTrigger>View the purchase</DrawerTrigger>
        <DrawerContent className="gap-4">
          <DrawerHeader>
            <DrawerTitle>Purchase</DrawerTitle>
            <DrawerClose>Close</DrawerClose>
          </DrawerHeader>
        </DrawerContent>
      </Drawer>
    );

    const trigger = screen.getByRole("button", { name: "View the purchase" });
    trigger.focus();
    fireEvent.click(trigger);

    const sheet = screen.getByRole("dialog", { name: "Purchase" });
    expect(sheet.className).toContain("right-0");
    expect(sheet.className).toContain("border-l");
    expect(sheet.className).toContain("gap-4");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
