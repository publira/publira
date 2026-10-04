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
  useToastManager: () => ({ add: vi.fn() }),
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

const episodes: EpisodeItem[] = [
  {
    availability: "",
    id: "EPISODE001-ID",
    orderIndex: 1,
    price: 0,
    publicId: "EPISODE001",
    publishedAt: "2026-06-01T00:00:00Z",
    readingPeriodHours: 72,
    scheduledAt: "",
    status: "published",
    title: "Episode 1",
  },
];

const renderList = (canEdit: boolean) =>
  render(
    <AdminLocaleTestProvider locale="en">
      <EpisodeSelectionProvider>
        <EpisodesSortableList
          canEdit={canEdit}
          episodes={episodes}
          reorderAction={vi.fn()}
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
});
