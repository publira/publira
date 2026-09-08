// @vitest-environment jsdom

import { getMessage } from "@publira/i18n";
import type { MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  CommentItem,
  CommentReportItem,
  CommentReportStatus,
} from "../comment-types";
import { CommentReportQueue } from "./comment-report-queue";

vi.mock("#components/message", () => ({
  Message: ({ message, values }: { message: string; values?: MessageValues }) =>
    getMessage(sharedCatalog("en"), message, values),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: React.ComponentProps<"a">) => (
    <a href={href}>{children}</a>
  ),
}));

// The three controls a row can carry are Client Components with a Server
// Action behind them, so what is checked here is which of them one report
// offers, not what they do.
vi.mock("./comment-action-button", () => ({
  CommentActionButton: ({
    action,
    publicId,
  }: {
    action: string;
    publicId: string;
  }) => <button type="button">{`${action} ${publicId}`}</button>,
}));

vi.mock("./comment-reason-dialog", () => ({
  CommentReasonDialog: ({
    action,
    publicId,
  }: {
    action: string;
    publicId: string;
  }) => <button type="button">{`${action} ${publicId}`}</button>,
}));

vi.mock("./comment-report-decision-button", () => ({
  CommentReportDecisionButton: ({
    reportId,
    resolution,
  }: {
    reportId: string;
    resolution: string;
  }) => <button type="button">{`${resolution} ${reportId}`}</button>,
}));

const reportedComment = (
  overrides: Partial<CommentItem> = {}
): CommentItem => ({
  authorName: "Reader",
  authorPublicId: "USER001",
  body: "A comment on the first episode.",
  createdAt: "2026-06-01T00:00:00Z",
  episodePublicId: "EPISODE001",
  episodeTitle: "Episode 1",
  hiddenAt: "",
  hiddenReason: "unknown",
  openReportCount: 1,
  publicId: "COMMENT0001",
  publishedAt: "2026-06-01T01:00:00Z",
  purgeDueAt: "",
  seriesPublicId: "SERIES001",
  seriesTitle: "Series A",
  status: "published",
  withdrawnAt: "",
  ...overrides,
});

const report = (
  status: CommentReportStatus,
  overrides: Partial<CommentReportItem> = {}
): CommentReportItem => ({
  comment: reportedComment(),
  createdAt: "2026-06-03T00:00:00Z",
  note: "Nothing to do with the episode.",
  reason: "spam",
  reportId: "REPORT0001",
  reporterName: "Another Reader",
  reporterPublicId: "USER002",
  resolvedAt: "",
  status,
  ...overrides,
});

const statusOptions = [
  { href: "?report_status=", status: "" },
  { href: "?report_status=open", status: "open" },
  { href: "?report_status=resolved", status: "resolved" },
  { href: "?report_status=rejected", status: "rejected" },
] as const;

const renderQueue = (reports: CommentReportItem[], listErrorMessage?: string) =>
  render(
    <CommentReportQueue
      listErrorMessage={listErrorMessage}
      locale="en"
      pageSize={20}
      reports={reports}
      status="open"
      statusOptions={statusOptions}
      timeZone="Asia/Tokyo"
    />
  );

afterEach(() => {
  cleanup();
});

describe("CommentReportQueue", () => {
  it("says there is nothing to show when the queue is empty", () => {
    renderQueue([]);

    expect(screen.getByText("There are no reports to show.")).toBeTruthy();
  });

  it("renders the failure instead of the queue when the read failed", () => {
    renderQueue([], "The API is unavailable.");

    expect(
      screen.getByText("Could not display the reported comments")
    ).toBeTruthy();
    expect(screen.getByText("The API is unavailable.")).toBeTruthy();
    expect(screen.queryByText("There are no reports to show.")).toBeNull();
  });

  it("shows what the reader said and the comment they said it about", () => {
    renderQueue([report("open")]);

    expect(screen.getByText("Spam or advertising")).toBeTruthy();
    expect(screen.getByText("Nothing to do with the episode.")).toBeTruthy();
    expect(screen.getByText(/Reported by Another Reader/u)).toBeTruthy();
    expect(screen.getByText("A comment on the first episode.")).toBeTruthy();
    expect(screen.getByText("1 report still waiting")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Episode 1" }).getAttribute("href")
    ).toBe("/series/SERIES001/episodes/EPISODE001");
  });

  it("offers both decisions and the removal controls on an open report", () => {
    renderQueue([report("open")]);

    expect(screen.getByText("resolved REPORT0001")).toBeTruthy();
    expect(screen.getByText("rejected REPORT0001")).toBeTruthy();
    // The comment is published, so it can be removed or purged from here but
    // there is nothing to restore.
    expect(screen.getByText("hide COMMENT0001")).toBeTruthy();
    expect(screen.getByText("purge COMMENT0001")).toBeTruthy();
    expect(screen.queryByText("restore COMMENT0001")).toBeNull();
  });

  it("offers a restore, and says a decision will not undo the removal, once the threshold has hidden the comment", () => {
    renderQueue([
      report("open", {
        comment: reportedComment({
          hiddenAt: "2026-06-04T00:00:00Z",
          hiddenReason: "auto_reports",
          openReportCount: 3,
          status: "hidden",
        }),
      }),
    ]);

    expect(
      screen.getByText(
        "Removed automatically once the reports passed the threshold."
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Deciding the reports does not put the comment back — restore it if it should return."
      )
    ).toBeTruthy();
    expect(screen.getByText("3 reports still waiting")).toBeTruthy();
    expect(screen.getByText("restore COMMENT0001")).toBeTruthy();
    expect(screen.queryByText("hide COMMENT0001")).toBeNull();
  });

  it("leaves a decided report with no decision to make", () => {
    renderQueue([report("rejected", { resolvedAt: "2026-06-05T00:00:00Z" })]);

    expect(screen.getByText("Already decided.")).toBeTruthy();
    expect(screen.getByText(/Decided on/u)).toBeTruthy();
    expect(screen.queryByText("resolved REPORT0001")).toBeNull();
    expect(screen.queryByText("rejected REPORT0001")).toBeNull();
    // The comment can still be acted on: the report being settled says nothing
    // about whether the comment should stay up.
    expect(screen.getByText("hide COMMENT0001")).toBeTruthy();
  });
});
