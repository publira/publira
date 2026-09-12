// @vitest-environment jsdom

import { getMessage } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgeRatingBadge } from "./age-rating-badge";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => getMessage(sharedCatalog("en"), message, values),
}));

afterEach(() => {
  cleanup();
});

describe("AgeRatingBadge", () => {
  it("Marks an r15 series as R15", () => {
    render(<AgeRatingBadge rating="r15" />);

    expect(screen.getByText("R15")).not.toBeNull();
  });

  it("Marks an r18 series as R18", () => {
    render(<AgeRatingBadge rating="r18" />);

    expect(screen.getByText("R18")).not.toBeNull();
  });

  it("Renders nothing for an unrestricted series", () => {
    const { container } = render(<AgeRatingBadge />);

    expect(container.textContent).toBe("");
  });
});
