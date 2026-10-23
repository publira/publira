// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import type { VolumeEpisodeOption } from "../../volume-types";
import { VolumeEpisodesEditor } from "./volume-episodes-editor";

vi.mock("#components/client-message", () => ({
  ClientMessage: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
  useClientMessages: () => bindMessages(sharedCatalog("en"), "en"),
}));

// The real combobox drops a floating popup jsdom cannot drive, and what is
// under test is which episodes the editor offers and what it does with the
// one that is chosen — so it stands in as a native control, rendered through
// `Input` so that its Field names it. The blank entry is "nothing picked yet".
vi.mock("@publira/ui-components/combobox", async () => {
  const { Input } = await import("@publira/ui-components/input");

  return {
    Empty: () => null,
    Input: () => null,
    Items: () => null,
    Popup: () => null,
    Root: ({
      items,
      onValueChange,
      value,
    }: {
      children: ReactNode;
      items: { label: string; value: string }[];
      onValueChange: (next: string) => void;
      value: string;
    }) => (
      <Input
        onChange={(event) => onValueChange(event.target.value)}
        render={
          <select>
            <option value="">-</option>
            {items.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        }
        value={value}
      />
    ),
  };
});

// dnd-kit measures the elements it sorts, which jsdom cannot do. Dragging is
// covered by the e2e suite; here the provider and the handle only have to
// render, so the list around them can be asserted on.
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

const episodes: VolumeEpisodeOption[] = [
  { id: "EPISODE001", position: 1, title: "The beginning" },
  { id: "EPISODE002", position: 2, title: "The middle" },
  { id: "EPISODE003", position: 3, title: "The end" },
  { id: "EPISODE004", position: 4, title: "The epilogue" },
];

const render = (props: {
  initialEpisodeIds: string[];
  lockedEpisodeIds?: string[];
  takenEpisodeIds?: string[];
}) =>
  renderBase(
    <VolumeEpisodesEditor
      episodes={episodes}
      initialEpisodeIds={props.initialEpisodeIds}
      lockedEpisodeIds={props.lockedEpisodeIds ?? []}
      takenEpisodeIds={props.takenEpisodeIds ?? []}
    />,
    {
      wrapper: ({ children }) => (
        <AdminLocaleTestProvider locale="en">
          {children}
        </AdminLocaleTestProvider>
      ),
    }
  );

/** What the form would post, which is the list the API stores in this order. */
const postedEpisodeIds = (): string[] => {
  const field = document.querySelector<HTMLInputElement>(
    'input[name="episode_ids"]'
  );
  if (!field) {
    throw new Error("the episode list field is not on screen");
  }
  return JSON.parse(field.value) as string[];
};

const picker = () =>
  screen.getByRole<HTMLSelectElement>("combobox", { name: "Add an episode" });

/** The episodes on offer; the mock's blank entry is not one of them. */
const offeredTitles = () =>
  [...picker().options]
    .filter((option) => option.value !== "")
    .map((option) => option.textContent);

afterEach(() => {
  cleanup();
});

describe("VolumeEpisodesEditor", () => {
  it("posts the episodes the volume holds, in its order", () => {
    render({ initialEpisodeIds: ["EPISODE002", "EPISODE001"] });

    expect(postedEpisodeIds()).toEqual(["EPISODE002", "EPISODE001"]);
    expect(
      screen.getByRole("button", { name: "Reorder The middle" })
    ).toBeTruthy();
  });

  it("offers only the episodes neither this volume nor another holds", () => {
    render({
      initialEpisodeIds: ["EPISODE001"],
      takenEpisodeIds: ["EPISODE003"],
    });

    expect(offeredTitles()).toEqual(["The middle", "The epilogue"]);
    expect(
      screen.getByText("Episodes another volume holds are not offered.")
    ).toBeTruthy();
  });

  it("adds the picked episode at the end of the list", () => {
    render({ initialEpisodeIds: ["EPISODE001"] });

    fireEvent.change(picker(), { target: { value: "EPISODE003" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(postedEpisodeIds()).toEqual(["EPISODE001", "EPISODE003"]);
    expect(offeredTitles()).toEqual(["The middle", "The epilogue"]);
  });

  it("takes out an episode the volume may give up", () => {
    render({ initialEpisodeIds: ["EPISODE001", "EPISODE002"] });

    fireEvent.click(
      screen.getByRole("button", { name: "Remove The beginning" })
    );

    expect(postedEpisodeIds()).toEqual(["EPISODE002"]);
  });

  // A checkout started while the volume was on sale still opens what it held.
  it("offers no way to take out an episode the volume held when it went on sale", () => {
    render({
      initialEpisodeIds: ["EPISODE001", "EPISODE002"],
      lockedEpisodeIds: ["EPISODE001", "EPISODE002"],
    });
    fireEvent.change(picker(), { target: { value: "EPISODE003" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(
      screen.queryByRole("button", { name: "Remove The beginning" })
    ).toBeNull();
    // An episode added since can still be taken out again before it is saved.
    fireEvent.click(screen.getByRole("button", { name: "Remove The end" }));
    expect(postedEpisodeIds()).toEqual(["EPISODE001", "EPISODE002"]);
  });

  it("says so when every episode is already in a volume", () => {
    render({
      initialEpisodeIds: ["EPISODE001", "EPISODE002"],
      takenEpisodeIds: ["EPISODE003", "EPISODE004"],
    });

    expect(
      screen.queryByRole("combobox", { name: "Add an episode" })
    ).toBeNull();
    expect(
      screen.getByText("Every episode of this series is already in a volume.")
    ).toBeTruthy();
  });
});
