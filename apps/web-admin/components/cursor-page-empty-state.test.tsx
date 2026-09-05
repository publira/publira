// @vitest-environment jsdom

import { getMessage } from "@publira/i18n";
import type { MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CursorPageEmptyState } from "./cursor-page-empty-state";

vi.mock("#components/message", () => ({
  Message: ({ message, values }: { message: string; values?: MessageValues }) =>
    getMessage(sharedCatalog("en"), message, values),
}));

afterEach(() => {
  cleanup();
});

describe("CursorPageEmptyState", () => {
  it("says nothing is registered yet and offers the create link when there is no pager", () => {
    render(
      <CursorPageEmptyState
        actions={<button type="button">Create an episode</button>}
        description="There are no episodes yet."
        hasPageLinks={false}
        itemLabel="Episodes"
        title="This series has no episodes yet."
      />
    );

    expect(screen.getByText("This series has no episodes yet.")).toBeDefined();
    expect(screen.getByRole("button")).toBeDefined();
  });

  it("does not say the whole list is empty when there is a pager", () => {
    render(
      <CursorPageEmptyState
        actions={<button type="button">Create an episode</button>}
        description="There are no episodes yet."
        hasPageLinks
        itemLabel="Episodes"
        title="This series has no episodes yet."
      />
    );

    expect(screen.getByText("No Episodes to show on this page.")).toBeDefined();
    // Only this page's rows are gone, so the way out is the pager rather than
    // creating a new record.
    expect(screen.queryByRole("button")).toBeNull();
  });
});
