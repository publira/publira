// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import * as ConsoleSection from ".";

afterEach(cleanup);

const renderSection = () =>
  render(
    <ConsoleSection.Stack>
      <ConsoleSection.Root>
        <ConsoleSection.Header>
          <ConsoleSection.Heading>
            <ConsoleSection.Title>Time zone</ConsoleSection.Title>
            <ConsoleSection.Description>
              The zone dates are shown in.
            </ConsoleSection.Description>
          </ConsoleSection.Heading>
          <ConsoleSection.Actions>
            <button type="button">Save</button>
          </ConsoleSection.Actions>
        </ConsoleSection.Header>
        <p>the form</p>
      </ConsoleSection.Root>
    </ConsoleSection.Stack>
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
    render(
      <ConsoleSection.Title id="creator-roles">Roles</ConsoleSection.Title>
    );

    expect(screen.getByRole("heading", { name: "Roles" }).id).toBe(
      "creator-roles"
    );
  });
});
