// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";
import type { EpisodeItem } from "#lib/episode";

import { EpisodeSelectionProvider } from "./episode-selection";
import { EpisodesSortableList } from "./episodes-sortable-list";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: ComponentProps<"a">) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@publira/ui-components/toast", () => ({
  useManager: () => ({ add: vi.fn() }),
}));

// dnd-kit measures the rows it sorts, which jsdom cannot do. What belongs here
// is which controls a row offers, not dragging.
vi.mock("@dnd-kit/react", () => ({
  DragDropProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@dnd-kit/react/sortable", () => ({
  useSortable: () => ({
    handleRef: vi.fn(),
    isDragging: false,
    ref: vi.fn(),
  }),
}));

const firstEpisode: EpisodeItem = {
  availability: "",
  eyeCatchImageUpdatedAt: "",
  eyeCatchImageVariants: [],
  id: "EPISODE001-ID",
  orderIndex: 1,
  previewPageCount: 0,
  price: 0,
  publicId: "EPISODE001",
  publishedAt: "2026-06-01T00:00:00Z",
  readingPeriodHours: 72,
  rentalPeriodHours: 0,
  rentalPrice: 0,
  reviewState: "",
  scheduledAt: "",
  status: "published",
  title: "Episode 1",
};

const episodes: EpisodeItem[] = [firstEpisode];

const renderList = (
  canEdit: boolean,
  items: EpisodeItem[] = episodes,
  reviewRequired = false
) =>
  render(
    <AdminLocaleTestProvider locale="en">
      <EpisodeSelectionProvider>
        <EpisodesSortableList
          canEdit={canEdit}
          currency="JPY"
          episodes={items}
          reorderAction={vi.fn()}
          reviewRequired={reviewRequired}
          seriesId="SERIES001-ID"
          seriesPublicId="SERIES001"
          timeZone="UTC"
        />
      </EpisodeSelectionProvider>
    </AdminLocaleTestProvider>
  );

afterEach(() => {
  cleanup();
});

describe("EpisodesSortableList", () => {
  it("offers an editor to reorder, pick, and edit each episode", () => {
    renderList(true);

    expect(
      screen.getByRole("button", { name: "Reorder Episode 1" })
    ).toBeTruthy();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: "Edit" }).getAttribute("href")
    ).toBe("/series/SERIES001/episodes/EPISODE001");
  });

  it("offers an auditor only to view each episode", () => {
    renderList(false);

    expect(screen.getByText("1. Episode 1")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(
      screen.getByRole("link", { name: "View" }).getAttribute("href")
    ).toBe("/series/SERIES001/episodes/EPISODE001");
  });

  it("marks a priced episode that opens pages before a purchase", () => {
    renderList(true, [{ ...firstEpisode, previewPageCount: 3, price: 120 }]);

    expect(screen.getByText("Preview: 3")).toBeTruthy();
  });

  it.each([
    ["a priced episode that opens none", 0, 120],
    ["a free episode, which opens its whole body", 3, 0],
  ])("does not mark %s", (_case, previewPageCount, price) => {
    renderList(true, [{ ...firstEpisode, previewPageCount, price }]);

    expect(screen.queryByText(/^Preview:/u)).toBeNull();
  });

  const scheduled: EpisodeItem = {
    ...firstEpisode,
    publishedAt: "",
    scheduledAt: "2026-12-01T00:00:00Z",
    status: "scheduled",
  };

  it.each([
    ["in_review", "In review"],
    ["returned", "Returned"],
  ] as const)(
    "marks a scheduled episode %s while the tenant requires review",
    (reviewState, label) => {
      renderList(true, [{ ...scheduled, reviewState }], true);

      expect(screen.getByText(label, { exact: true })).toBeTruthy();
    }
  );

  it("does not mark an episode's review while the tenant does not require it", () => {
    renderList(true, [{ ...scheduled, reviewState: "returned" }], false);

    expect(screen.queryByText("Returned", { exact: true })).toBeNull();
  });

  it("does not mark a published episode with the state its last round left", () => {
    renderList(true, [{ ...firstEpisode, reviewState: "in_review" }], true);

    expect(screen.queryByText("In review", { exact: true })).toBeNull();
  });
});
