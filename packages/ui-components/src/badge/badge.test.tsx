// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Badge } from "./badge";
import { StatusChip } from "./status-chip";

afterEach(cleanup);

const classesOf = (text: string): string[] => [
  ...screen.getByText(text).classList,
];

describe("Badge", () => {
  it("takes the control radius rather than the shape of a pill", () => {
    render(<Badge tone="success">Published</Badge>);

    const classes = classesOf("Published");
    expect(classes).toContain("rounded-control");
    expect(classes).not.toContain("rounded-full");
  });

  it("keeps a tinted fill in the soft variant", () => {
    render(
      <Badge tone="warning" variant="soft">
        Scheduled
      </Badge>
    );

    expect(classesOf("Scheduled")).toContain("bg-warning/10");
  });

  // A column of outlined boxes fights the hairlines of the table it sits in.
  it("renders the outline variant as a dot and its text, with no box", () => {
    render(
      <Badge tone="success" variant="outline">
        Published
      </Badge>
    );

    const classes = classesOf("Published");
    expect(classes).toContain("before:bg-success");
    expect(classes).toContain("before:rounded-full");
    expect(classes).not.toContain("border");
    expect(classes.some((name) => name.startsWith("rounded-"))).toBe(false);
  });
});

describe("StatusChip", () => {
  it("adds its own indicator to a badge that has no dot of its own", () => {
    const { container } = render(<StatusChip status="info">Draft</StatusChip>);

    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(1);
  });

  it("leaves the dot to the outline badge, which draws one already", () => {
    const { container } = render(
      <StatusChip status="info" variant="outline">
        Draft
      </StatusChip>
    );

    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(0);
  });
});
