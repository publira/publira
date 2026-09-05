// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsFlash } from "./settings-flash";

const mockUseSearchParams = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockUseSearchParams(),
}));

afterEach(() => {
  cleanup();
});

const searchParams = (query: Record<string, string>) =>
  new URLSearchParams(query);

describe("SettingsFlash", () => {
  it("renders a success message as a status live region", () => {
    mockUseSearchParams.mockReturnValue(
      searchParams({ message: "Saved", status: "success" })
    );
    render(<SettingsFlash />);

    expect(screen.getByRole("status").textContent).toBe("Saved");
  });

  it("renders an error message as an alert", () => {
    mockUseSearchParams.mockReturnValue(
      searchParams({ message: "Could not save", status: "error" })
    );
    render(<SettingsFlash />);

    expect(screen.getByRole("alert").textContent).toBe("Could not save");
  });

  it("renders nothing when the query has no message", () => {
    mockUseSearchParams.mockReturnValue(searchParams({}));
    render(<SettingsFlash />);

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
