// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  SectionError,
  SectionErrorActions,
  SectionErrorDescription,
  SectionErrorDigestLine,
  SectionErrorDigestValue,
  SectionErrorHeading,
  SectionErrorTitle,
} from "./section-error";

describe("SectionError", () => {
  it("shows the heading and the description with the alert role", () => {
    render(
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            Could not load the operator list
          </SectionErrorTitle>
          <SectionErrorDescription>
            You do not have permission to perform this action.
          </SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Could not load the operator list")).toBeTruthy();
    expect(
      screen.getByText("You do not have permission to perform this action.")
    ).toBeTruthy();
  });

  it("keeps the digest next to the prefix that introduces it", () => {
    render(
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>Could not load</SectionErrorTitle>
        </SectionErrorHeading>
        <SectionErrorDigestLine>
          Error ID:{" "}
          <SectionErrorDigestValue>2870412426</SectionErrorDigestValue>
        </SectionErrorDigestLine>
      </SectionError>
    );

    expect(screen.getByText("2870412426")).toBeTruthy();
    expect(screen.getByText(/Error ID:/u)).toBeTruthy();
  });

  it("renders actions as they are", () => {
    render(
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>Could not load</SectionErrorTitle>
        </SectionErrorHeading>
        <SectionErrorActions>
          <button type="button">Try again</button>
        </SectionErrorActions>
      </SectionError>
    );

    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
