// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Identifier, IdentifierCopy, IdentifierValue } from "./identifier";

afterEach(cleanup);

const renderIdentifier = (writeText: () => Promise<void>) => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

  return render(
    <Identifier>
      <IdentifierValue>SeedMMBRAAA1</IdentifierValue>
      <IdentifierCopy aria-label="Copy the public ID" value="SeedMMBRAAA1" />
    </Identifier>
  );
};

describe("Identifier", () => {
  // The console has one typeface for its data; a monospace face for a handful
  // of identifiers reads as a different kind of value rather than a precise one.
  it("sets the value in the sans face with tabular figures", () => {
    renderIdentifier(() => Promise.resolve());

    const classes = [...screen.getByText("SeedMMBRAAA1").classList];
    expect(classes).toContain("tabular-nums");
    expect(classes).not.toContain("font-mono");
  });

  it("copies the exact value when the control is used", () => {
    const writeText = vi.fn(() => Promise.resolve());
    renderIdentifier(writeText);

    fireEvent.click(screen.getByRole("button", { name: "Copy the public ID" }));

    expect(writeText).toHaveBeenCalledWith("SeedMMBRAAA1");
  });

  // A browser that refuses the clipboard leaves the control as it was rather
  // than claiming a copy that did not happen.
  it("stays quiet when the clipboard is unavailable", () => {
    renderIdentifier(() => Promise.reject(new Error("denied")));

    fireEvent.click(screen.getByRole("button", { name: "Copy the public ID" }));

    expect(
      screen.getByRole("button", { name: "Copy the public ID" })
    ).toBeDefined();
  });
});
