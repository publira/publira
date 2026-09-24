// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  EmptyStateActions,
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CursorPageEmptyState } from "./cursor-page-empty-state";

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

describe("CursorPageEmptyState", () => {
  it("says nothing is registered yet and offers the create link when there is no pager", () => {
    render(
      <CursorPageEmptyState hasPageLinks={false} itemLabel="Episodes">
        <EmptyStateHeading>
          <EmptyStateTitle>This series has no episodes yet.</EmptyStateTitle>
          <EmptyStateDescription>
            There are no episodes yet.
          </EmptyStateDescription>
        </EmptyStateHeading>
        <EmptyStateActions>
          <button type="button">Create an episode</button>
        </EmptyStateActions>
      </CursorPageEmptyState>
    );

    expect(screen.getByText("This series has no episodes yet.")).toBeDefined();
    expect(screen.getByRole("button")).toBeDefined();
  });

  it("does not say the whole list is empty when there is a pager", () => {
    render(
      <CursorPageEmptyState hasPageLinks itemLabel="Episodes">
        <EmptyStateHeading>
          <EmptyStateTitle>This series has no episodes yet.</EmptyStateTitle>
          <EmptyStateDescription>
            There are no episodes yet.
          </EmptyStateDescription>
        </EmptyStateHeading>
        <EmptyStateActions>
          <button type="button">Create an episode</button>
        </EmptyStateActions>
      </CursorPageEmptyState>
    );

    expect(screen.getByText("No Episodes to show on this page.")).toBeDefined();
    expect(screen.queryByText("This series has no episodes yet.")).toBeNull();
    // Only this page's rows are gone, so the way out is the pager rather than
    // creating a new record.
    expect(screen.queryByRole("button")).toBeNull();
  });
});
