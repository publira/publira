import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
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
  CommentReportReasonMessage,
  CommentReportStatusMessage,
  commentReportStatusTone,
} from "./comment-report-labels";
import {
  CommentStatusMessage,
  commentStatusTone,
} from "./comment-status-label";

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
  /** For the timestamps and the two strings that have to be attributes. */
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
  ariaLabel,
  status,
  statusOptions,
}: {
  ariaLabel: string;
  status: string;
  statusOptions: readonly CommentReportStatusOption[];
}) => (
  <nav aria-label={ariaLabel} className="flex flex-wrap gap-2">
    {statusOptions.map((option) => (
      <LinkButton
        href={option.href}
        key={option.status || "all"}
        size="sm"
        variant={option.status === status ? "default" : "outline"}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          {option.status === "" ? (
            <Message message="admin.comments.reports.filter_all" />
          ) : (
            <CommentReportStatusMessage status={option.status} />
          )}
        </Suspense>
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
 * The removal the threshold made is the case that needs it: staff are
 * reviewing a decision nobody made by hand, and deciding the reports is not
 * what puts the comment back.
 */
const ReportedCommentNotes = ({ report }: { report: CommentReportItem }) => {
  if (report.comment.status !== "hidden") {
    return null;
  }

  return (
    <>
      <span className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-3 w-64" />}>
          {report.comment.hiddenReason === "auto_reports" ? (
            <Message message="admin.comments.hidden_by_reports" />
          ) : (
            <Message message="admin.comments.hidden_by_staff" />
          )}
        </Suspense>
      </span>
      <span className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-3 w-72" />}>
          <Message message="admin.comments.reports.removal_stands" />
        </Suspense>
      </span>
    </>
  );
};

/** One report: what the reader picked, what they wrote, and who they are. */
const ReportSummary = ({
  locale,
  report,
  timeZone,
}: {
  locale: Locale;
  report: CommentReportItem;
  timeZone: string;
}) => (
  <div className="grid gap-1">
    <StatusChip status={commentReportStatusTone(report.status)}>
      <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
        <CommentReportStatusMessage status={report.status} />
      </Suspense>
    </StatusChip>
    <span className="font-medium">
      <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
        <CommentReportReasonMessage reason={report.reason} />
      </Suspense>
    </span>
    {report.note ? (
      <p className="text-xs whitespace-pre-wrap text-muted-foreground">
        {report.note}
      </p>
    ) : null}
    <span className="text-xs text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-3 w-56" />}>
        <Message
          message="admin.comments.reports.reported_by"
          values={{
            at: formatReportDateTime(report.createdAt, locale, timeZone),
            reporter: report.reporterName || report.reporterPublicId,
          }}
        />
      </Suspense>
    </span>
    {report.resolvedAt ? (
      <span className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-3 w-40" />}>
          <Message
            message="admin.comments.reports.decided_at"
            values={{
              at: formatReportDateTime(report.resolvedAt, locale, timeZone),
            }}
          />
        </Suspense>
      </span>
    ) : null}
  </div>
);

/** The reported comment in the state it is actually in. */
const ReportedComment = ({ report }: { report: CommentReportItem }) => (
  <div className="grid gap-1">
    <p className="text-sm whitespace-pre-wrap">{report.comment.body}</p>
    <div className="flex flex-wrap items-center gap-2">
      <StatusChip status={commentStatusTone(report.comment.status)}>
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          <CommentStatusMessage status={report.comment.status} />
        </Suspense>
      </StatusChip>
      <span className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-3 w-32" />}>
          {report.comment.openReportCount === 1 ? (
            <Message message="admin.comments.reports.open_count_one" />
          ) : (
            <Message
              message="admin.comments.reports.open_count"
              values={{ count: report.comment.openReportCount }}
            />
          )}
        </Suspense>
      </span>
    </div>
    <span className="text-xs text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-3 w-40" />}>
        <Message
          message="admin.comments.reports.written_by"
          values={{
            author: report.comment.authorName || report.comment.authorPublicId,
          }}
        />
      </Suspense>
    </span>
    <ReportedCommentNotes report={report} />
  </div>
);

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
        description={
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.comments.reports.empty_description" />
          </Suspense>
        }
        hasPageLinks={hasPageLinks}
        // Interpolated into another message, so this one has to be a string.
        itemLabel={getMessage(
          sharedCatalog(locale),
          "admin.comments.reports.item_label"
        )}
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.comments.reports.empty_title" />
          </Suspense>
        }
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-56">
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.comments.reports.columns.report" />
            </Suspense>
          </TableHead>
          <TableHead>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.comments.reports.columns.comment" />
            </Suspense>
          </TableHead>
          <TableHead className="w-56">
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.comments.reports.columns.episode" />
            </Suspense>
          </TableHead>
          <TableHead className="w-40">
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.comments.reports.columns.decision" />
            </Suspense>
          </TableHead>
          <TableHead className="w-36">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.comments.reports.columns.comment_actions" />
            </Suspense>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reports.map((report) => (
          <TableRow key={report.reportId}>
            <TableCell>
              <ReportSummary
                locale={locale}
                report={report}
                timeZone={timeZone}
              />
            </TableCell>
            <TableCell>
              <ReportedComment report={report} />
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
                  <Suspense fallback={<SkeletonLine className="h-3 w-24" />}>
                    <Message message="admin.comments.reports.already_done" />
                  </Suspense>
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
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  const showPagination =
    !listErrorMessage && (reports.length > 0 || hasPageLinks);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
            <Message message="admin.comments.reports.title" />
          </Suspense>
        </CardTitle>
        <CardDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="admin.comments.reports.description" />
          </Suspense>
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        {/* An `aria-label` cannot be a node, so it is resolved as a string. */}
        <CommentReportStatusFilter
          ariaLabel={getMessage(
            sharedCatalog(locale),
            "admin.comments.reports.filter_aria"
          )}
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
              sharedCatalog(locale),
              "admin.comments.reports.pagination_aria"
            )}
            description={
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message
                  message="admin.comments.reports.pagination_description"
                  values={{ count: pageSize }}
                />
              </Suspense>
            }
            nextHref={nextHref}
            previousHref={previousHref}
          />
        ) : null}
      </CardContent>
    </Card>
  );
};
