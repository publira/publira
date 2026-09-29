// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ConsoleSection,
  ConsoleSectionActions,
  ConsoleSectionDescription,
  ConsoleSectionHeader,
  ConsoleSectionHeading,
  ConsoleSections,
  ConsoleSectionTitle,
} from "./console-section";

afterEach(cleanup);

const renderSection = () =>
  render(
    <ConsoleSections>
      <ConsoleSection>
        <ConsoleSectionHeader>
          <ConsoleSectionHeading>
            <ConsoleSectionTitle>Time zone</ConsoleSectionTitle>
            <ConsoleSectionDescription>
              The zone dates are shown in.
            </ConsoleSectionDescription>
          </ConsoleSectionHeading>
          <ConsoleSectionActions>
            <button type="button">Save</button>
          </ConsoleSectionActions>
        </ConsoleSectionHeader>
        <p>the form</p>
      </ConsoleSection>
    </ConsoleSections>
  );

describe("ConsoleSection", () => {
  it("names the section with a second-level heading", () => {
    renderSection();

    expect(
      screen.getByRole("heading", { level: 2, name: "Time zone" })
    ).toBeDefined();
  });

  // A section is a heading and a gap: a box around one form would draw a second
  // boundary around what the heading has already named.
  it("draws no surface of its own", () => {
    const { container } = renderSection();

    const section = container.querySelector("section");
    const classes = [...(section?.classList ?? [])];
    expect(classes.some((name) => name.startsWith("bg-"))).toBe(false);
    expect(classes.some((name) => name.startsWith("border"))).toBe(false);
    expect(classes.some((name) => name.startsWith("shadow-"))).toBe(false);
    expect(classes.some((name) => name.startsWith("rounded"))).toBe(false);
  });

  it("gives the title an id so another element can point at it", () => {
    render(<ConsoleSectionTitle id="creator-roles">Roles</ConsoleSectionTitle>);

    expect(screen.getByRole("heading", { name: "Roles" }).id).toBe(
      "creator-roles"
    );
  });
});
