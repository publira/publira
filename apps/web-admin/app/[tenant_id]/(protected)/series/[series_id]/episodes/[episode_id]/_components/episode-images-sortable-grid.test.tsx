// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";
import type { EpisodeImageItem } from "#lib/episode";

import { EpisodeImagesSortableGrid } from "./episode-images-sortable-grid";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("next/image", () => ({
  // oxlint-disable-next-line next/no-img-element -- stub for the optimized image
  default: ({ alt, src }: ComponentProps<"img">) => <img alt={alt} src={src} />,
}));

vi.mock("@publira/ui-components/toast", () => ({
  useToastManager: () => ({ add: vi.fn() }),
}));

// dnd-kit measures the cells it sorts, which jsdom cannot do. What belongs
// here is which controls a cell offers, not dragging.
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

const images: EpisodeImageItem[] = [
  {
    contentType: "image/webp",
    displayOrder: 1,
    fileSizeBytes: "1024",
    height: 1600,
    id: "IMAGE001",
    imageUrl: "https://cdn.example.com/episodes/EPISODE001/1.webp",
    width: 1200,
  },
];

const renderGrid = (canEdit: boolean) =>
  render(
    <AdminLocaleTestProvider locale="en">
      <EpisodeImagesSortableGrid
        canEdit={canEdit}
        deleteAction={vi.fn()}
        episodeId="EPISODE001-ID"
        episodePublicId="EPISODE001"
        images={images}
        reorderAction={vi.fn()}
        seriesPublicId="SERIES001"
      />
    </AdminLocaleTestProvider>
  );

afterEach(() => {
  cleanup();
});

describe("EpisodeImagesSortableGrid", () => {
  it("gives an editor a grip to move each page by, and a way to replace or delete it", () => {
    renderGrid(true);

    expect(screen.getByRole("button", { name: "Reorder page 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace page 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete page 1" })).toBeTruthy();
  });

  it("shows an auditor the pages with nothing to move them by", () => {
    renderGrid(false);

    expect(screen.getByRole("img", { name: "Page 1" })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
