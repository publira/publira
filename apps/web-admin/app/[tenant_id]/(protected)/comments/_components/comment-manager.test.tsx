// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CommentItem, CommentStatus } from "../comment-types";
import { CommentManager } from "./comment-manager";

vi.mock("#lib/messages", () => ({
  getMessagesFor: () => Promise.resolve(bindMessages(sharedCatalog("en"))),
  loadAdminMessages: () => Promise.resolve(sharedCatalog("en")),
}));

vi.mock("#components/client-message", () => ({
  ClientMessage: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
  useClientMessages: () => bindMessages(sharedCatalog("en")),
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: React.ComponentProps<"a">) => (
    <a href={href}>{children}</a>
  ),
}));

// Both controls are forms carrying a Server Action, so what is checked here is
// which of them a row offers, not what they do.
vi.mock("./comment-action-button", () => ({
  CommentActionButton: ({
    action,
    commentId,
  }: {
    action: string;
    commentId: string;
  }) => <button type="button">{`${action} ${commentId}`}</button>,
}));

vi.mock("./comment-reason-dialog", () => ({
  CommentReasonDialog: ({
    action,
    commentId,
  }: {
    action: string;
    commentId: string;
  }) => <button type="button">{`${action} ${commentId}`}</button>,
}));

const comment = (
  status: CommentStatus,
  overrides: Partial<CommentItem> = {}
): CommentItem => ({
  authorIsStaff: false,
  authorName: "Reader",
  authorPublicId: "USER001",
  body: "A comment on the first episode.",
  createdAt: "2026-06-01T00:00:00Z",
  creator: null,
  episodePublicId: "EPISODE001",
  episodeTitle: "Episode 1",
  hiddenAt: "",
  hiddenReason: "unknown",
  id: "018f0f80-0002-7000-8000-000000000001",
  openReportCount: 0,
  publishedAt: "",
  purgeDueAt: "",
  seriesPublicId: "SERIES001",
  seriesTitle: "Series A",
  status,
  withdrawnAt: "",
  ...overrides,
});

afterEach(() => {
  cleanup();
});

describe("CommentManager", () => {
  it("says there is nothing to show when the first page is empty", async () => {
    render(
      await CommentManager({
        canModerate: true,
        canViewReaders: true,
        comments: [],
        locale: "en",
        pageSize: 20,
        tenantId: "TENANT001",
        timeZone: "UTC",
      })
    );

    expect(screen.getByText("There are no comments to show.")).toBeTruthy();
  });

  it("renders the failure instead of the list when the read failed", async () => {
    render(
      await CommentManager({
        canModerate: true,
        canViewReaders: true,
        comments: [],
        listErrorMessage: "The API is unavailable.",
        locale: "en",
        pageSize: 20,
        tenantId: "TENANT001",
        timeZone: "UTC",
      })
    );

    expect(screen.getByText("Could not display the comments")).toBeTruthy();
    expect(screen.getByText("The API is unavailable.")).toBeTruthy();
    expect(screen.queryByText("There are no comments to show.")).toBeNull();
  });

  it("offers approve, remove, and purge on a comment awaiting approval", async () => {
    render(
      await CommentManager({
        canModerate: true,
        canViewReaders: true,
        comments: [comment("pending")],
        locale: "en",
        pageSize: 20,
        tenantId: "TENANT001",
        timeZone: "UTC",
      })
    );

    expect(
      screen.getByText("approve 018f0f80-0002-7000-8000-000000000001")
    ).toBeTruthy();
    expect(
      screen.getByText("hide 018f0f80-0002-7000-8000-000000000001")
    ).toBeTruthy();
    expect(
      screen.getByText("purge 018f0f80-0002-7000-8000-000000000001")
    ).toBeTruthy();
    expect(
      screen.queryByText("restore 018f0f80-0002-7000-8000-000000000001")
    ).toBeNull();
  });

  it("offers only a purge on a comment its author deleted", async () => {
    render(
      await CommentManager({
        canModerate: true,
        canViewReaders: true,
        comments: [
          comment("withdrawn", {
            purgeDueAt: "2099-06-08T00:00:00Z",
            withdrawnAt: "2026-06-01T09:00:00Z",
          }),
        ],
        locale: "en",
        pageSize: 20,
        tenantId: "TENANT001",
        timeZone: "UTC",
      })
    );

    expect(
      screen.getByText("purge 018f0f80-0002-7000-8000-000000000001")
    ).toBeTruthy();
    expect(
      screen.queryByText("approve 018f0f80-0002-7000-8000-000000000001")
    ).toBeNull();
    expect(
      screen.queryByText("hide 018f0f80-0002-7000-8000-000000000001")
    ).toBeNull();
    expect(
      screen.queryByText("restore 018f0f80-0002-7000-8000-000000000001")
    ).toBeNull();
  });

  it("names who removed a comment and warns that its author still reads it", async () => {
    render(
      await CommentManager({
        canModerate: true,
        canViewReaders: true,
        comments: [
          comment("hidden", {
            hiddenAt: "2026-06-02T00:00:00Z",
            hiddenReason: "auto_reports",
          }),
        ],
        locale: "en",
        pageSize: 20,
        tenantId: "TENANT001",
        timeZone: "UTC",
      })
    );

    expect(
      screen.getByText(
        "Removed automatically once the reports passed the threshold."
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        "The commenter still sees it exactly as they posted it — they are never told about a removal."
      )
    ).toBeTruthy();
    expect(
      screen.getByText("restore 018f0f80-0002-7000-8000-000000000001")
    ).toBeTruthy();
  });

  it("counts the days a withdrawn comment has left in the tenant time zone", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(
      Temporal.Instant.from("2026-06-01T20:00:00Z").epochMilliseconds
    );
    try {
      render(
        await CommentManager({
          canModerate: true,
          canViewReaders: true,
          comments: [
            comment("withdrawn", {
              // 2026-06-08 in UTC, where 2026-06-01T20:00Z is already
              // the 2nd — six days, not seven.
              purgeDueAt: "2026-06-07T15:00:00Z",
              withdrawnAt: "2026-06-01T09:00:00Z",
            }),
          ],
          locale: "en",
          pageSize: 20,
          tenantId: "TENANT001",
          timeZone: "UTC",
        })
      );

      expect(screen.getByText(/Purged for good in 6 days/u)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("links the episode to its page in the console", async () => {
    render(
      await CommentManager({
        canModerate: true,
        canViewReaders: true,
        comments: [comment("published")],
        locale: "en",
        pageSize: 20,
        tenantId: "TENANT001",
        timeZone: "UTC",
      })
    );

    expect(
      screen.getByRole("link", { name: "Episode 1" }).getAttribute("href")
    ).toBe("/series/SERIES001/episodes/EPISODE001");
  });

  it("links the commenter to their reader page", async () => {
    render(
      await CommentManager({
        canModerate: true,
        canViewReaders: true,
        comments: [comment("published")],
        locale: "en",
        pageSize: 20,
        tenantId: "TENANT001",
        timeZone: "UTC",
      })
    );

    expect(
      screen.getByRole("link", { name: "Reader" }).getAttribute("href")
    ).toBe("/readers/USER001");
  });

  it("shows a staff commenter without a link, since staff have no reader page", async () => {
    render(
      await CommentManager({
        canModerate: true,
        canViewReaders: true,
        comments: [
          comment("published", {
            authorIsStaff: true,
            authorName: "Editor",
            authorPublicId: "STAFF001",
          }),
        ],
        locale: "en",
        pageSize: 20,
        tenantId: "TENANT001",
        timeZone: "UTC",
      })
    );

    expect(screen.getByText("Editor")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Editor" })).toBeNull();
  });

  it("marks a comment by the episode's author with the badge and the credited name", async () => {
    render(
      await CommentManager({
        canModerate: true,
        canViewReaders: true,
        comments: [
          comment("published", {
            creator: { name: "Sample Author", publicId: "CREATOR001" },
          }),
        ],
        locale: "en",
        pageSize: 20,
        tenantId: "TENANT001",
        timeZone: "UTC",
      })
    );

    expect(screen.getByText("Author")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Sample Author" }).getAttribute("href")
    ).toBe("/creators/CREATOR001");
  });

  it("leaves every other comment unmarked", async () => {
    render(
      await CommentManager({
        canModerate: true,
        canViewReaders: true,
        comments: [comment("published")],
        locale: "en",
        pageSize: 20,
        tenantId: "TENANT001",
        timeZone: "UTC",
      })
    );

    expect(screen.queryByText("Author")).toBeNull();
  });

  it("offers a tenant auditor no moderation", async () => {
    render(
      await CommentManager({
        canModerate: false,
        canViewReaders: false,
        comments: [comment("pending")],
        locale: "en",
        pageSize: 20,
        tenantId: "TENANT001",
        timeZone: "UTC",
      })
    );

    expect(screen.getByText("A comment on the first episode.")).toBeTruthy();
    // The pager is all that is left to press.
    expect(
      screen.queryAllByRole("button").map((button) => button.textContent)
    ).toEqual(["Previous", "Next"]);
    expect(screen.queryByText("Actions")).toBeNull();
  });

  it("shows the commenter without a link to an operator who cannot open readers", async () => {
    render(
      await CommentManager({
        canModerate: true,
        canViewReaders: false,
        comments: [comment("published")],
        locale: "en",
        pageSize: 20,
        tenantId: "TENANT001",
        timeZone: "UTC",
      })
    );

    expect(screen.getByText("Reader")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Reader" })).toBeNull();
  });
});
