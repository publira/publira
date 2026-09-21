// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SeriesAvailabilityBadge } from "./series-availability-badge";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
}));

afterEach(() => {
  cleanup();
});

describe("SeriesAvailabilityBadge", () => {
  it("marks a series kept to the storefront", () => {
    const { container } = render(
      <SeriesAvailabilityBadge availability="web" />
    );

    expect(container.textContent).toBe("Web only");
  });

  it("marks a series kept to the app", () => {
    const { container } = render(
      <SeriesAvailabilityBadge availability="app" />
    );

    expect(container.textContent).toBe("App only");
  });

  // Both surfaces is the ordinary case, and marking it would bury the rows
  // that are not.
  it("leaves a series on both surfaces unmarked", () => {
    const { container } = render(
      <SeriesAvailabilityBadge availability="all" />
    );

    expect(container.textContent).toBe("");
  });
});
