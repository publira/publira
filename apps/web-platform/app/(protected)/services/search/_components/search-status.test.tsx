// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MessageProps } from "#components/message";
import { getMessagesFor } from "#lib/messages";
import type { PlatformMessageAccessor } from "#lib/messages";
import type { PlatformSearchSettings } from "#lib/search-settings-shared";

import { SearchStatus } from "./search-status";

const state = vi.hoisted(() => ({
  t: undefined as PlatformMessageAccessor | undefined,
}));

// `<Message>` is an async Server Component that only the Next.js compiler can
// render. The catalog is the real one, resolved ahead so the tree renders
// without suspending.
vi.mock("#components/message", () => ({
  Message: ({ message, values }: MessageProps) => state.t?.(message, values),
}));

// The refresh needs the App Router; what matters here is whether the status
// mounts it.
vi.mock("./search-build-refresh", () => ({
  SearchBuildRefresh: () => <span data-testid="build-refresh" />,
}));

const settings: PlatformSearchSettings = {
  analysis: "{}",
  buildFailure: null,
  buildState: "serving",
  defaultAnalysis: true,
  engine: "opensearch",
  hasPassword: false,
  index: "publira-catalog",
  revision: "4",
  serving: {
    engine: "sql",
    index: "",
    revision: "2",
    since: "2026-10-01T00:00:00Z",
    url: "",
  },
  url: "https://search.example.com",
  username: "",
};

const renderStatus = (overrides: Partial<PlatformSearchSettings>) =>
  render(
    <SearchStatus
      locale="en"
      settings={{ ...settings, ...overrides }}
      timeZone="UTC"
    />
  );

beforeEach(async () => {
  state.t = await getMessagesFor("en");
});

afterEach(() => {
  cleanup();
});

describe("SearchStatus", () => {
  it("asks again while the worker builds the saved engine's index", () => {
    renderStatus({ buildState: "building" });

    expect(
      screen.getByText(/The OpenSearch index is being built/u)
    ).toBeTruthy();
    expect(screen.getByTestId("build-refresh")).toBeTruthy();
  });

  // The worker retries a failed build on every pass, so an engine repaired
  // after the failure is picked up without saving again.
  it("keeps asking after a build failed, with the error it recorded", () => {
    renderStatus({
      buildFailure: {
        error: "connection refused",
        failedAt: "2026-10-02T03:04:05Z",
      },
      buildState: "failed",
    });

    expect(
      screen.getByText(/The OpenSearch index couldn't be built/u)
    ).toBeTruthy();
    expect(screen.getByText("connection refused")).toBeTruthy();
    expect(screen.getByTestId("build-refresh")).toBeTruthy();
  });

  // A changed text analysis is built into a new index for the target that
  // keeps answering, so naming the serving engine would read as no move at all.
  it("words a rebuild for the target the search answers from as a new index", () => {
    renderStatus({
      buildState: "building",
      serving: {
        ...settings.serving,
        engine: "opensearch",
        index: "publira-catalog",
        url: "https://search.example.com",
      },
    });

    expect(
      screen.getByText(
        "A new OpenSearch index is being built with the saved text analysis. Until it's ready, the search keeps answering from the current index. This page checks again every few seconds."
      )
    ).toBeTruthy();
    expect(screen.queryByText(/for the saved settings/u)).toBeNull();
    expect(screen.getByTestId("build-refresh")).toBeTruthy();
  });

  it("words a failed rebuild as the current index still answering", () => {
    renderStatus({
      buildFailure: {
        error: "illegal_argument_exception: Unknown tokenizer type [nori]",
        failedAt: "2026-10-02T03:04:05Z",
      },
      buildState: "failed",
      serving: {
        ...settings.serving,
        engine: "opensearch",
        index: "publira-catalog",
        url: "https://search.example.com",
      },
    });

    expect(
      screen.getByText(/^The new OpenSearch index couldn't be built/u)
    ).toBeTruthy();
    expect(
      screen.getByText(
        "illegal_argument_exception: Unknown tokenizer type [nori]"
      )
    ).toBeTruthy();
  });

  it("stops asking once the saved settings answer", () => {
    renderStatus({
      buildState: "serving",
      serving: { ...settings.serving, engine: "opensearch" },
    });

    expect(screen.queryByTestId("build-refresh")).toBeNull();
  });
});
