// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FreeUntilBadge } from "./free-until-badge";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: string;
    values?: Record<string, string>;
  }) => `${message} ${values?.date ?? ""}`,
}));

afterEach(cleanup);

/** 23:59 on Sunday 11 October in Tokyo, and 07:59 that morning in Los Angeles. */
const FREE_UNTIL = "2026-10-11T14:59:00Z";

describe("FreeUntilBadge", () => {
  it("Writes the end of the period in the tenant's time zone", () => {
    render(
      <FreeUntilBadge
        freeUntil={FREE_UNTIL}
        locale="ja"
        timeZone="Asia/Tokyo"
      />
    );

    expect(
      screen.getByText("host.common.free_until 10月11日(日) 23:59")
    ).toBeDefined();
  });

  it("Moves the weekday and the time with the time zone", () => {
    render(
      <FreeUntilBadge
        freeUntil={FREE_UNTIL}
        locale="ja"
        timeZone="America/Los_Angeles"
      />
    );

    expect(
      screen.getByText("host.common.free_until 10月11日(日) 7:59")
    ).toBeDefined();
  });

  it("Marks the end up as a machine-readable instant", () => {
    const { container } = render(
      <FreeUntilBadge
        freeUntil={FREE_UNTIL}
        locale="en"
        timeZone="Asia/Tokyo"
      />
    );

    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(
      FREE_UNTIL
    );
  });
});
