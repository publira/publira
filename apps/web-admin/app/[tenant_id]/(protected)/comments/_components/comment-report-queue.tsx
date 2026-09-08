import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { StatusChip } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";
import Link from "next/link";
import { Suspense } from "react";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import { PaginationFooter } from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";

import type { CommentReportItem, CommentReportStatus } from "../comment-types";
import { CommentActionButton } from "./comment-action-button";
import { CommentReasonDialog } from "./comment-reason-dialog";
import { CommentReportDecisionButton } from "./comment-report-decision-button";
import {
  commentReportReasonLabel,
  commentReportStatusLabel,
  commentReportStatusTone,
} from "./comment-report-labels";
import { commentStatusLabel, commentStatusTone } from "./comment-status-label";

/**
 * One state the queue can be narrowed to, and where the link that does it
 * points. `""` is every state, which is how the decisions already made are read
 * back beside the reports still waiting.
 */
export interface CommentReportStatusOption {
  href: string;
  status: CommentReportStatus | "";
}

type CommentReportQueueProps = CursorPageHrefs & {
  listErrorMessage?: string;
  locale: Locale;
  pageSize: number;
  reports: CommentReportItem[];
  /** The state being shown, so the filter marks the link that is current. */
  status: string;
  statusOptions: readonly CommentReportStatusOption[];
  timeZone: string;
};

const formatReportDateTime = (
  value: string,
  locale: Locale,
  timeZone: string
): string => (value ? formatDateTime(value, { locale, timeZone }) : "—");

/**
 * The state filter, written as links rather than as a `method="GET"` form.
 *
 * The screen carries two lists with query parameters of their own, and such a
 * form serializes only its own fields: submitting one would drop the other
 * list's filters and cursor from the URL. A link carries the whole query it
 * was built with, so switching the report state leaves the comment list where
 * the operator had it.
 */
const CommentReportStatusFilter = ({
  messages,
  status,
  statusOptions,
}: {
  messages: SharedMessages;
  status: string;
  statusOptions: readonly CommentReportStatusOption[];
}) => (
  <nav
    aria-label={getMessage(messages, "admin.comments.reports.filter_aria")}
    className="flex flex-wrap gap-2"
  >
    {statusOptions.map((option) => (
      <LinkButton
        href={option.href}
        key={option.status || "all"}
        size="sm"
        variant={option.status === status ? "default" : "outline"}
      >
        {option.status === ""
          ? getMessage(messages, "admin.comments.reports.filter_all")
          : commentReportStatusLabel(option.status, messages)}
      </LinkButton>
    ))}
  </nav>
);

/**
 * The removal controls one reported comment offers.
 *
 * They are the comment list's own, on the row that made staff look at the
 * comment in the first place: a moderator who agrees with a report should not
 * have to find the same comment on a second screen to act on it. Which ones
 * appear follows from the comment's state, exactly as it does there.
 */
const ReportedCommentActions = ({ report }: { report: CommentReportItem }) => (
  <div className="grid gap-2">
    {report.comment.status === "hidden" ? (
      <CommentActionButton
        action="restore"
        publicId={report.comment.publicId}
      />
    ) : null}
    {report.comment.status === "pending" ||
    report.comment.status === "published" ? (
      <CommentReasonDialog action="hide" publicId={report.comment.publicId} />
    ) : null}
    <CommentReasonDialog action="purge" publicId={report.comment.publicId} />
  </div>
);

/**
 * What the comment's own state says to someone working the report.
 *
 * The removal that the threshold made is the case that needs it: staff are
 * reviewing a decision nobody made by hand, and rejecting the reports is not
 * what puts the comment back.
 */
const ReportedCommentNotes = ({
  messages,
  report,
}: {
  messages: SharedMessages;
  report: CommentReportItem;
}) => {
  if (report.comment.status !== "hidden") {
    return null;
  }

  return (
    <>
      <span className="text-xs text-muted-foreground">
        {report.comment.hiddenReason === "auto_reports"
          ? getMessage(messages, "admin.comments.hidden_by_reports")
          : getMessage(messages, "admin.comments.hidden_by_staff")}
      </span>
      <span className="text-xs text-muted-foreground">
        {getMessage(messages, "admin.comments.reports.removal_stands")}
      </span>
    </>
  );
};

const CommentReportListBody = ({
  hasPageLinks,
  listErrorMessage,
  locale,
  reports,
  timeZone,
}: {
  hasPageLinks: boolean;
  listErrorMessage?: string;
  locale: Locale;
  reports: CommentReportItem[];
  timeZone: string;
}) => {
  const messages = sharedCatalog(locale);
  if (listErrorMessage) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.comments.reports.list_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{listErrorMessage}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  if (reports.length === 0) {
    return (
      <CursorPageEmptyState
        description={getMessage(
          messages,
          "admin.comments.reports.empty_description"
        )}
        hasPageLinks={hasPageLinks}
        itemLabel={getMessage(messages, "admin.comments.reports.item_label")}
        title={getMessage(messages, "admin.comments.reports.empty_title")}
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-56">
            {getMessage(messages, "admin.comments.reports.columns.report")}
          </TableHead>
          <TableHead>
            {getMessage(messages, "admin.comments.reports.columns.comment")}
          </TableHead>
          <TableHead className="w-56">
            {getMessage(messages, "admin.comments.reports.columns.episode")}
          </TableHead>
          <TableHead className="w-40">
            {getMessage(messages, "admin.comments.reports.columns.decision")}
          </TableHead>
          <TableHead className="w-36">
            {getMessage(
              messages,
              "admin.comments.reports.columns.comment_actions"
            )}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reports.map((report) => (
          <TableRow key={report.reportId}>
            <TableCell>
              <div className="grid gap-1">
                <StatusChip status={commentReportStatusTone(report.status)}>
                  {commentReportStatusLabel(report.status, messages)}
                </StatusChip>
                <span className="font-medium">
                  {commentReportReasonLabel(report.reason, messages)}
                </span>
                {report.note ? (
                  <p className="text-xs whitespace-pre-wrap text-muted-foreground">
                    {report.note}
                  </p>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {getMessage(messages, "admin.comments.reports.reported_by", {
                    at: formatReportDateTime(
                      report.createdAt,
                      locale,
                      timeZone
                    ),
                    reporter: report.reporterName || report.reporterPublicId,
                  })}
                </span>
                {report.resolvedAt ? (
                  <span className="text-xs text-muted-foreground">
                    {getMessage(messages, "admin.comments.reports.decided_at", {
                      at: formatReportDateTime(
                        report.resolvedAt,
                        locale,
                        timeZone
                      ),
                    })}
                  </span>
                ) : null}
              </div>
            </TableCell>
            <TableCell>
              <div className="grid gap-1">
                <p className="text-sm whitespace-pre-wrap">
                  {report.comment.body}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip status={commentStatusTone(report.comment.status)}>
                    {commentStatusLabel(report.comment.status, messages)}
                  </StatusChip>
                  <span className="text-xs text-muted-foreground">
                    {getMessage(
                      messages,
                      report.comment.openReportCount === 1
                        ? "admin.comments.reports.open_count_one"
                        : "admin.comments.reports.open_count",
                      { count: report.comment.openReportCount }
                    )}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {getMessage(messages, "admin.comments.reports.written_by", {
                    author:
                      report.comment.authorName ||
                      report.comment.authorPublicId,
                  })}
                </span>
                <ReportedCommentNotes messages={messages} report={report} />
              </div>
            </TableCell>
            <TableCell>
              <div className="grid gap-0.5">
                <Link
                  className="font-medium underline-offset-4 hover:underline"
                  href={`/series/${report.comment.seriesPublicId}/episodes/${report.comment.episodePublicId}`}
                >
                  {report.comment.episodeTitle ||
                    report.comment.episodePublicId}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {report.comment.seriesTitle || report.comment.seriesPublicId}
                </span>
              </div>
            </TableCell>
            <TableCell>
              {report.status === "open" ? (
                <div className="grid gap-2">
                  <CommentReportDecisionButton
                    reportId={report.reportId}
                    resolution="resolved"
                  />
                  <CommentReportDecisionButton
                    reportId={report.reportId}
                    resolution="rejected"
                  />
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {getMessage(messages, "admin.comments.reports.already_done")}
                </span>
              )}
            </TableCell>
            <TableCell>
              <ReportedCommentActions report={report} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export const CommentReportQueue = ({
  listErrorMessage,
  locale,
  nextHref,
  pageSize,
  previousHref,
  reports,
  status,
  statusOptions,
  timeZone,
}: CommentReportQueueProps) => {
  const messages = sharedCatalog(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  const showPagination =
    !listErrorMessage && (reports.length > 0 || hasPageLinks);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {getMessage(messages, "admin.comments.reports.title")}
        </CardTitle>
        <CardDescription>
          {getMessage(messages, "admin.comments.reports.description")}
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        <CommentReportStatusFilter
          messages={messages}
          status={status}
          statusOptions={statusOptions}
        />

        <CommentReportListBody
          hasPageLinks={hasPageLinks}
          listErrorMessage={listErrorMessage}
          locale={locale}
          reports={reports}
          timeZone={timeZone}
        />

        {showPagination ? (
          <PaginationFooter
            ariaLabel={getMessage(
              messages,
              "admin.comments.reports.pagination_aria"
            )}
            description={getMessage(
              messages,
              "admin.comments.reports.pagination_description",
              { count: pageSize }
            )}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        ) : null}
      </CardContent>
    </Card>
  );
};
