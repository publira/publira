// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SectionError } from "./section-error";

describe("SectionError", () => {
  it("shows the heading and the description with the alert role", () => {
    render(
      <SectionError
        description="You do not have permission to perform this action."
        title="Could not load the operator list"
      />
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Could not load the operator list")).toBeTruthy();
    expect(
      screen.getByText("You do not have permission to perform this action.")
    ).toBeTruthy();
  });

  it("the error ID appears only when a digest is given", () => {
    const { rerender } = render(<SectionError title="Could not load" />);

    expect(screen.queryByText("2870412426")).toBeNull();

    rerender(
      <SectionError
        digest={{ label: "Error ID:", value: "2870412426" }}
        title="Could not load"
      />
    );

    expect(screen.getByText("2870412426")).toBeTruthy();
    expect(screen.getByText("Error ID:")).toBeTruthy();
  });

  it("renders actions as they are", () => {
    render(
      <SectionError
        actions={<button type="button">Try again</button>}
        title="Could not load"
      />
    );

    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
