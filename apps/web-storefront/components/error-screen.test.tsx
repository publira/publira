// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithClientMessages } from "#lib/render-with-client-messages";

import * as ErrorScreen from "./error-screen";

afterEach(() => {
  cleanup();
});

describe("ErrorScreen", () => {
  it("shows the caller's title as the page heading", async () => {
    await renderWithClientMessages(
      <ErrorScreen.Root retry={vi.fn()}>
        <ErrorScreen.Title>Could not show this page</ErrorScreen.Title>
      </ErrorScreen.Root>
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Could not show this page",
      })
    ).toBeDefined();
  });

  it("shows the digest behind the catalog's prefix", async () => {
    await renderWithClientMessages(
      <ErrorScreen.Root digest="2870412426" retry={vi.fn()}>
        <ErrorScreen.Digest />
      </ErrorScreen.Root>
    );

    expect(screen.getByText("2870412426")).toBeDefined();
    expect(screen.getByText(/Error ID:/u)).toBeDefined();
  });

  it("leaves the digest line out when the error carries none", async () => {
    await renderWithClientMessages(
      <ErrorScreen.Root retry={vi.fn()}>
        <ErrorScreen.Digest />
      </ErrorScreen.Root>
    );

    expect(screen.queryByText(/Error ID:/u)).toBeNull();
  });

  it("re-renders the boundary from the retry control", async () => {
    const retry = vi.fn();
    await renderWithClientMessages(
      <ErrorScreen.Root retry={retry}>
        <ErrorScreen.Actions>
          <ErrorScreen.Retry />
        </ErrorScreen.Actions>
      </ErrorScreen.Root>
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(retry).toHaveBeenCalledTimes(1);
  });
});
