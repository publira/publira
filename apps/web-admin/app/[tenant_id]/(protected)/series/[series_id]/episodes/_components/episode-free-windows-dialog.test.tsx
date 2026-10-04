// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import { EpisodeFreeWindowsDialog } from "./episode-free-windows-dialog";
import { EpisodeSelectionProvider } from "./episode-selection";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

vi.mock("@publira/ui-components/toast", () => ({
  useToastManager: () => ({ add: vi.fn() }),
}));

const openDialog = (selectedIds: readonly string[]) => {
  render(
    <AdminLocaleTestProvider locale="en">
      <EpisodeSelectionProvider initialSelectedIds={selectedIds}>
        <EpisodeFreeWindowsDialog
          action={vi.fn()}
          seriesId="SERIES001-ID"
          timeZone="UTC"
        />
      </EpisodeSelectionProvider>
    </AdminLocaleTestProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: "Free reading period" }));
};

const hiddenValue = (name: string): string | undefined =>
  document.querySelector<HTMLInputElement>(
    `input[type="hidden"][name="${name}"]`
  )?.value;

describe("EpisodeFreeWindowsDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("starts on the checked episodes and posts them", () => {
    openDialog(["EP1-ID", "EP2-ID"]);

    expect(
      screen.getByRole("radio", { checked: true, name: "Selected episodes" })
    ).toBeDefined();
    expect(screen.getByText("2 episodes selected on the list.")).toBeDefined();
    expect(hiddenValue("target")).toBe("selected");
    expect(JSON.parse(hiddenValue("episode_ids") ?? "")).toEqual([
      "EP1-ID",
      "EP2-ID",
    ]);
  });

  it("offers the first episodes when nothing is checked, and asks how many", () => {
    openDialog([]);

    expect(
      screen
        .getByRole("radio", { name: "Selected episodes" })
        .getAttribute("aria-disabled")
    ).toBe("true");
    expect(hiddenValue("target")).toBe("first");
    expect(
      screen.getByRole("spinbutton", { name: "Number of episodes" })
    ).toBeDefined();
  });

  it("drops the count once the whole series is chosen", () => {
    openDialog([]);

    fireEvent.click(screen.getByRole("radio", { name: "All episodes" }));

    expect(hiddenValue("target")).toBe("all");
    expect(
      screen.queryByRole("spinbutton", { name: "Number of episodes" })
    ).toBeNull();
  });
});
