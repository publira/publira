// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Field, FieldLabel } from "../field/field";
import { RadioGroup } from "./radio-group";

const items = [
  {
    description: "Anyone can read it as soon as it is posted.",
    label: "Publish straight away",
    value: "immediate",
  },
  {
    description: "Only its author sees it until it is approved.",
    label: "Publish after approval",
    value: "approval_required",
  },
] as const;

afterEach(cleanup);

describe("RadioGroup", () => {
  // Inside a Field, Base UI hands each radio the field's own aria-labelledby,
  // and a wrapping <label> cannot name a role="radio" span. Without the
  // per-item association a screen reader announces every option as "Comments".
  it("names each option after its own label, not after the surrounding field", () => {
    render(
      <Field>
        <FieldLabel>Comments</FieldLabel>
        <RadioGroup items={items} value="immediate" />
      </Field>
    );

    expect(
      screen.getByRole("radio", { name: /Publish straight away/u })
    ).toBeDefined();
    expect(
      screen.getByRole("radio", { name: /Publish after approval/u })
    ).toBeDefined();
  });

  it("describes each option with its own sentence", () => {
    render(<RadioGroup items={items} value="immediate" />);

    const radio = screen.getByRole("radio", {
      name: /Publish after approval/u,
    });
    const describedBy = radio.getAttribute("aria-describedby") ?? "";

    expect(
      document.querySelector(`#${CSS.escape(describedBy)}`)?.textContent
    ).toBe("Only its author sees it until it is approved.");
  });

  it("gives two groups mounted at once separate item ids", () => {
    render(
      <>
        <RadioGroup items={items} value="immediate" />
        <RadioGroup items={items} value="immediate" />
      </>
    );

    const labelledBy = screen
      .getAllByRole("radio")
      .map((radio) => radio.getAttribute("aria-labelledby"));

    expect(new Set(labelledBy).size).toBe(labelledBy.length);
  });
});
