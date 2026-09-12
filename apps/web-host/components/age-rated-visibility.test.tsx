// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeConfirmedAgeRating } from "#lib/age-rating-confirmation";

import {
  AgeRatedHiddenNotice,
  AgeRatedVisibility,
} from "./age-rated-visibility";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "tenant-1",
}));

vi.mock("#components/client-message", () => ({
  ClientMessage: ({ message }: { message: string }) => message,
}));

vi.mock("#components/locale-provider", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "en",
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("AgeRatedVisibility", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("Shows an unrestricted series without a confirmation", () => {
    render(
      <AgeRatedVisibility>
        <p>Open series</p>
      </AgeRatedVisibility>
    );

    expect(screen.getByText("Open series")).not.toBeNull();
  });

  it("Hides a rated series until this browser confirms", () => {
    render(
      <AgeRatedVisibility rating="r18">
        <p>Rated series</p>
      </AgeRatedVisibility>
    );

    expect(screen.queryByText("Rated series")).toBeNull();
  });

  it("Shows a rated series after this browser has confirmed", async () => {
    writeConfirmedAgeRating("tenant-1", "r18");

    render(
      <AgeRatedVisibility rating="r18">
        <p>Rated series</p>
      </AgeRatedVisibility>
    );

    await waitFor(() => {
      expect(screen.getByText("Rated series")).not.toBeNull();
    });
  });
});

describe("AgeRatedHiddenNotice", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("Says rated hits are hidden while this browser has not confirmed", () => {
    render(<AgeRatedHiddenNotice ratings={[undefined, "r15"]} />);

    expect(screen.getByText("host.search.age_rated_hidden")).not.toBeNull();
  });

  it("Stays out of the way once every rating on the page is confirmed", async () => {
    writeConfirmedAgeRating("tenant-1", "r18");

    render(<AgeRatedHiddenNotice ratings={["r15", "r18"]} />);

    await waitFor(() => {
      expect(screen.queryByText("host.search.age_rated_hidden")).toBeNull();
    });
  });
});
