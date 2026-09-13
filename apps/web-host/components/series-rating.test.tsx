// @vitest-environment jsdom

import { getMessage } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getMySeriesRating } from "#lib/series-rating";

import { MySeriesRating, SeriesRating } from "./series-rating";

vi.mock("#lib/series-rating", () => ({ getMySeriesRating: vi.fn() }));

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

describe("SeriesRating", () => {
  it("Shows a one-decimal average and reader count without a rating control", () => {
    render(<SeriesRating average={3} count={12} locale="en" />);
    expect(screen.getByText("Rating: 3.0 · 12 readers")).not.toBeNull();
    expect(
      screen.getByText("React to episodes to rate this series.")
    ).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("Omits the public figure when no readers have reacted", () => {
    render(<SeriesRating average={0} count={0} locale="en" />);
    expect(screen.queryByText(/Rating:/u)).toBeNull();
    expect(
      screen.getByText("React to episodes to rate this series.")
    ).not.toBeNull();
  });
  it("Shows the reader's own figure beside the public one", async () => {
    vi.mocked(getMySeriesRating).mockResolvedValue(4.25);
    render(
      <SeriesRating average={3.2} count={12} locale="en">
        {await MySeriesRating({
          locale: "en",
          seriesPublicId: "series-1",
          tenantId: "tenant-1",
        })}
      </SeriesRating>
    );
    expect(screen.getByText("Rating: 3.2 · 12 readers")).not.toBeNull();
    expect(screen.getByText("Your rating: 4.3")).not.toBeNull();
  });
  it("Omits the private figure when the read has no rating", async () => {
    vi.mocked(getMySeriesRating).mockResolvedValue(null);
    const { container } = render(
      await MySeriesRating({
        locale: "en",
        seriesPublicId: "series-1",
        tenantId: "tenant-1",
      })
    );
    expect(container.textContent).toBe("");
  });
});
