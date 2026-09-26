// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import type {
  CreatorRoleListItem,
  CreatorRoleReorderResult,
} from "../creator-role-types";
import { CreatorRoleList } from "./creator-role-list";

const reorder =
  vi.fn<(formData: FormData) => Promise<CreatorRoleReorderResult>>();

/**
 * The shape of a drop, as much of it as `move` reads: which row was picked up
 * and which one it was let go over.
 */
interface DropEvent {
  operation: {
    canceled: boolean;
    source: { id: string };
    target: { id: string };
  };
}

/**
 * dnd-kit measures the rows it sorts, which jsdom cannot do, so the provider
 * stands in and hands the drop back to the test instead. Dragging itself is an
 * e2e concern; what belongs here is what the list does with a drop.
 */
const dnd = vi.hoisted(() => ({
  drop: null as ((event: DropEvent) => void) | null,
}));

vi.mock("@dnd-kit/react", () => ({
  DragDropProvider: ({
    children,
    onDragEnd,
  }: {
    children: ReactNode;
    onDragEnd: (event: DropEvent) => void;
  }) => {
    dnd.drop = onDragEnd;
    return children;
  },
}));

vi.mock("@dnd-kit/react/sortable", () => ({
  useSortable: () => ({
    handleRef: vi.fn(),
    isDragging: false,
    ref: vi.fn(),
  }),
}));

// The Actions are `"use server"`, so the module they live in cannot be
// evaluated here at all. What the list is responsible for is the payload it
// hands them, which is why `reorder` is inspected rather than stubbed away.
vi.mock("../_lib/actions", () => ({
  deleteCreatorRoleAction: vi.fn(),
  renameCreatorRoleAction: vi.fn(),
  reorderCreatorRolesAction: (formData: FormData) => reorder(formData),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const creatorRoles: CreatorRoleListItem[] = [
  { name: "Original Author", publicId: "ROLE001" },
  { name: "Artist", publicId: "ROLE002" },
  { name: "Writer", publicId: "ROLE003" },
];

const EnglishConsole = ({ children }: { children: ReactNode }) => (
  <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
);

const renderList = async (ui: ReactNode) => {
  await act(() => {
    render(ui, { wrapper: EnglishConsole });
  });
  await screen.findByRole("button", { name: "Reorder Artist" });
};

/** Drop the row `sourceId` names over the row `targetId` names. */
const dropOver = async (sourceId: string, targetId: string) => {
  const { drop } = dnd;
  if (!drop) {
    throw new Error("the list was never rendered");
  }

  await act(() => {
    drop({
      operation: {
        canceled: false,
        source: { id: sourceId },
        target: { id: targetId },
      },
    });
  });
};

/** The role names in the order the rows are on screen. */
const namesOnScreen = () =>
  screen.getAllByRole<HTMLInputElement>("textbox").map((input) => input.value);

const submittedOrder = (field: string): string[] => {
  const formData = reorder.mock.calls.at(0)?.at(0);
  if (!formData) {
    throw new Error("the reorder Action was never called");
  }
  return JSON.parse(String(formData.get(field))) as string[];
};

beforeEach(() => {
  dnd.drop = null;
  reorder.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
});

describe("CreatorRoleList", () => {
  it("lists the roles in priority order and states each position", async () => {
    await renderList(<CreatorRoleList creatorRoles={creatorRoles} />);

    expect(namesOnScreen()).toEqual(["Original Author", "Artist", "Writer"]);
    expect(
      screen.getAllByText(/^Priority /u).map((hint) => hint.textContent)
    ).toEqual(["Priority 1", "Priority 2", "Priority 3"]);
  });

  // The name box carries no visible label — the value in it is the name — so
  // the only thing that names it for a screen reader is the visually hidden
  // label `Field` ties to it.
  it("names each name box after the role it edits", async () => {
    await renderList(<CreatorRoleList creatorRoles={creatorRoles} />);

    expect(
      screen.getByRole<HTMLInputElement>("textbox", {
        name: "Name of Artist",
      }).value
    ).toBe("Artist");
  });

  // The handle is what the pointer, the touch screen and the keyboard sensor
  // all pick a row up by, so every row has to offer one.
  it("gives every row a drag handle named after the role it moves", async () => {
    await renderList(<CreatorRoleList creatorRoles={creatorRoles} />);

    expect(
      screen
        .getAllByRole("button", { name: /^Reorder /u })
        .map((handle) => handle.textContent)
    ).toEqual(["Reorder Original Author", "Reorder Artist", "Reorder Writer"]);
  });

  it("posts the whole order it wants beside the one it was showing", async () => {
    await renderList(<CreatorRoleList creatorRoles={creatorRoles} />);

    await dropOver("ROLE002", "ROLE001");

    await waitFor(() => {
      expect(reorder).toHaveBeenCalledTimes(1);
    });
    expect(submittedOrder("creator_role_public_ids")).toEqual([
      "ROLE002",
      "ROLE001",
      "ROLE003",
    ]);
    // The order the rows were rendered from. The API refuses the write when
    // this no longer matches what the tenant's roles are in.
    expect(submittedOrder("expected_creator_role_public_ids")).toEqual([
      "ROLE001",
      "ROLE002",
      "ROLE003",
    ]);
  });

  // A drop that put the row back where it came from changes nothing, so there
  // is no order to post and no conflict to risk.
  it("writes nothing when the row is dropped where it started", async () => {
    await renderList(<CreatorRoleList creatorRoles={creatorRoles} />);

    await dropOver("ROLE002", "ROLE002");

    expect(reorder).not.toHaveBeenCalled();
  });

  it("moves the row as soon as the drop lands", async () => {
    // Never resolved: the assertion is about the window the write is open in.
    const pending = Promise.withResolvers<CreatorRoleReorderResult>();
    reorder.mockReturnValue(pending.promise);

    await renderList(<CreatorRoleList creatorRoles={creatorRoles} />);

    await dropOver("ROLE002", "ROLE001");

    await waitFor(() => {
      expect(namesOnScreen()).toEqual(["Artist", "Original Author", "Writer"]);
    });
    expect(
      screen.getAllByText(/^Priority /u).map((hint) => hint.textContent)
    ).toEqual(["Priority 1", "Priority 2", "Priority 3"]);
  });

  it("reports a reorder the server refused", async () => {
    reorder.mockResolvedValue({
      message: "The role priority changed somewhere else.",
      ok: false,
    });

    await renderList(<CreatorRoleList creatorRoles={creatorRoles} />);

    await dropOver("ROLE002", "ROLE001");

    expect(
      await screen.findByText("The role priority changed somewhere else.")
    ).toBeDefined();
  });
});
