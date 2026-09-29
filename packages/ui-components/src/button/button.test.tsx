// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "./button";

afterEach(cleanup);

const classesOf = (name: string): string[] => [
  ...screen.getByRole("button", { name }).classList,
];

describe("Button", () => {
  it("takes the control radius, never a larger one", () => {
    render(<Button>Save changes</Button>);

    const classes = classesOf("Save changes");
    expect(classes).toContain("rounded-control");
    expect(classes.filter((name) => name.startsWith("rounded-"))).toEqual([
      "rounded-control",
    ]);
  });

  it("shows the focus ring on the ring token", () => {
    render(<Button>Save changes</Button>);

    const classes = classesOf("Save changes");
    expect(classes).toContain("focus-visible:ring-ring");
    expect(classes).toContain("focus-visible:ring-2");
  });

  // Fading the whole control takes the label down with the fill and lands it
  // on the surface a disabled button uses.
  it("moves the fill on hover rather than the opacity", () => {
    render(<Button>Save changes</Button>);

    const classes = classesOf("Save changes");
    expect(classes).toContain("bg-primary");
    expect(classes).not.toContain("hover:opacity-90");
    expect(
      classes.some((name) => name.startsWith("hover:bg-[color-mix("))
    ).toBe(true);
  });

  it("draws a destructive action as an outline in crimson", () => {
    render(<Button variant="destructive">Delete series</Button>);

    const classes = classesOf("Delete series");
    expect(classes).toContain("border-destructive");
    expect(classes).toContain("text-destructive");
    expect(classes).not.toContain("bg-destructive");
  });

  it("fills the confirming button of a dialog", () => {
    render(<Button variant="destructiveFilled">Delete series</Button>);

    const classes = classesOf("Delete series");
    expect(classes).toContain("bg-destructive");
    expect(classes).toContain("text-destructive-foreground");
  });

  it("carries no shadow in any variant", () => {
    render(
      <>
        <Button>Save changes</Button>
        <Button variant="outline">Cancel</Button>
        <Button variant="secondary">Read</Button>
      </>
    );

    for (const name of ["Save changes", "Cancel", "Read"]) {
      expect(
        classesOf(name).some((className) => className.startsWith("shadow-"))
      ).toBe(false);
    }
  });
});
