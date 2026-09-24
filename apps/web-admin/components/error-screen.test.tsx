// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ErrorScreen,
  ErrorScreenDigest,
  ErrorScreenRetry,
} from "./error-screen";

afterEach(() => {
  cleanup();
});

describe("ErrorScreen", () => {
  it("shows the digest behind the caller's prefix", () => {
    render(
      <ErrorScreen digest="2870412426" retry={vi.fn()}>
        <ErrorScreenDigest>Error ID:</ErrorScreenDigest>
      </ErrorScreen>
    );

    expect(screen.getByText("2870412426")).toBeDefined();
    expect(screen.getByText(/Error ID:/u)).toBeDefined();
  });

  it("leaves the digest line out when the error carries none", () => {
    render(
      <ErrorScreen digest={undefined} retry={vi.fn()}>
        <ErrorScreenDigest>Error ID:</ErrorScreenDigest>
      </ErrorScreen>
    );

    expect(screen.queryByText(/Error ID:/u)).toBeNull();
  });

  it("re-renders the boundary from the retry control", () => {
    const retry = vi.fn();
    render(
      <ErrorScreen digest={undefined} retry={retry}>
        <ErrorScreenRetry>Retry</ErrorScreenRetry>
      </ErrorScreen>
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(retry).toHaveBeenCalledTimes(1);
  });
});
