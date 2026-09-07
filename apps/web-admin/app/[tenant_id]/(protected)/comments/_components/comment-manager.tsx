import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { StatusChip } from "@publira/ui-components/badge";
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
import { formatDateTime, parseInstant } from "@publira/utils";
import Link from "next/link";
import { Suspense } from "react";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import { PaginationFooter } from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";

import type { CommentItem } from "../comment-types";
import { CommentActionButton } from "./comment-action-button";
import { CommentReasonDialog } from "./comment-reason-dialog";
import { commentStatusLabel, commentStatusTone } from "./comment-status-label";

type CommentManagerProps = CursorPageHrefs & {
  comments: CommentItem[];
  listErrorMessage?: string;
  locale: Locale;
  pageSize: number;
  timeZone: string;
};

// Absolute API timestamp → tenant display zone. `formatDateTime` falls back to
// the raw value when it cannot be parsed, so only the empty case is special.
const formatCommentDateTime = (
  value: string,
  locale: Locale,
  timeZone: string
): string => (value ? formatDateTime(value, { locale, timeZone }) : "—");

/**
 * Whole days between today and the purge deadline, counted in the tenant's
 * time zone.
 *
 * The zone is the tenant's rather than UTC for the same reason the timestamps
 * beside it are: "two days left" has to mean two of the days the operator is
 * living through. `null` is a deadline that could not be parsed, which is
 * reported as the bare date instead of as a wrong number.
 */
const daysUntilPurge = (
  purgeDueAt: string,
  timeZone: string
): number | null => {
  const due = parseInstant(purgeDueAt);
  if (!due) {
    return null;
  }

  const today = Temporal.Now.zonedDateTimeISO(timeZone).toPlainDate();
  const deadline = due.toZonedDateTimeISO(timeZone).toPlainDate();
  return today.until(deadline, { largestUnit: "day" }).days;
};

/**
 * What a withdrawn comment says about the clock it is on.
 *
 * Three keys rather than one interpolated count, because "1 days left" is
 * wrong in English and the message syntax here carries no plural selection.
 */
const purgeNotice = (
  comment: CommentItem,
  locale: Locale,
  messages: SharedMessages,
  timeZone: string
): string => {
  const at = formatCommentDateTime(comment.purgeDueAt, locale, timeZone);
  const days = daysUntilPurge(comment.purgeDueAt, timeZone);
  if (days === null || days <= 0) {
    return getMessage(messages, "admin.comments.purge_due_now", { at });
  }
  if (days === 1) {
    return getMessage(messages, "admin.comments.purge_due_one_day", { at });
  }
  return getMessage(messages, "admin.comments.purge_due_days", { at, days });
};

/**
 * The sentences under a comment's state chip.
 *
 * A removal is the case that needs them: staff have to know whether they or
 * the report threshold took the comment down, and that the author still reads
 * it exactly as it was — otherwise being quoted their own removed comment
 * looks like the removal failed.
 */
const CommentStateNotes = ({
  comment,
  locale,
  messages,
  timeZone,
}: {
  comment: CommentItem;
  locale: Locale;
  messages: SharedMessages;
  timeZone: string;
}) => {
  if (comment.status === "hidden") {
    return (
      <>
        <span className="text-xs text-muted-foreground">
          {comment.hiddenReason === "auto_reports"
            ? getMessage(messages, "admin.comments.hidden_by_reports")
            : getMessage(messages, "admin.comments.hidden_by_staff")}
        </span>
        <span className="text-xs text-muted-foreground">
          {getMessage(messages, "admin.comments.hidden_author_notice")}
        </span>
        <span className="text-xs text-muted-foreground">
          {getMessage(messages, "admin.comments.hidden_at", {
            at: formatCommentDateTime(comment.hiddenAt, locale, timeZone),
          })}
        </span>
      </>
    );
  }

  if (comment.status === "withdrawn") {
    return (
      <>
        <span className="text-xs text-muted-foreground">
          {getMessage(messages, "admin.comments.withdrawn_by_author", {
            at: formatCommentDateTime(comment.withdrawnAt, locale, timeZone),
          })}
        </span>
        <span className="text-xs text-muted-foreground">
          {purgeNotice(comment, locale, messages, timeZone)}
        </span>
      </>
    );
  }

  return null;
};

/**
 * The controls one comment offers, which follow from the state it is in.
 *
 * Only a pending comment can be approved and only a removed one restored, so
 * an unavailable transition is absent rather than disabled: the API answers
 * `failed_precondition` for it, and a button that can only fail is not a
 * control. A purge is offered in every state — that is the point of it.
 */
const CommentRowActions = ({ comment }: { comment: CommentItem }) => (
  <div className="grid gap-2">
    {comment.status === "pending" ? (
      <CommentActionButton action="approve" publicId={comment.publicId} />
    ) : null}
    {comment.status === "hidden" ? (
      <CommentActionButton action="restore" publicId={comment.publicId} />
    ) : null}
    {comment.status === "pending" || comment.status === "published" ? (
      <CommentReasonDialog action="hide" publicId={comment.publicId} />
    ) : null}
    <CommentReasonDialog action="purge" publicId={comment.publicId} />
  </div>
);

const CommentListBody = ({
  comments,
  hasPageLinks,
  listErrorMessage,
  locale,
  timeZone,
}: {
  comments: CommentItem[];
  hasPageLinks: boolean;
  listErrorMessage?: string;
  locale: Locale;
  timeZone: string;
}) => {
  const messages = sharedCatalog(locale);
  if (listErrorMessage) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.comments.list_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{listErrorMessage}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  if (comments.length === 0) {
    return (
      <CursorPageEmptyState
        description={getMessage(messages, "admin.comments.empty_description")}
        hasPageLinks={hasPageLinks}
        itemLabel={getMessage(messages, "admin.comments.item_label")}
        title={getMessage(messages, "admin.comments.empty_title")}
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-56">
            {getMessage(messages, "admin.comments.columns.status")}
          </TableHead>
          <TableHead>
            {getMessage(messages, "admin.comments.columns.comment")}
          </TableHead>
          <TableHead className="w-48">
            {getMessage(messages, "admin.comments.columns.author")}
          </TableHead>
          <TableHead className="w-56">
            {getMessage(messages, "admin.comments.columns.episode")}
          </TableHead>
          <TableHead className="w-44">
            {getMessage(messages, "admin.comments.columns.created_at")}
          </TableHead>
          <TableHead className="w-36">
            {getMessage(messages, "admin.comments.columns.actions")}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {comments.map((comment) => (
          <TableRow key={comment.publicId}>
            <TableCell>
              <div className="grid gap-1">
                <StatusChip status={commentStatusTone(comment.status)}>
                  {commentStatusLabel(comment.status, messages)}
                </StatusChip>
                <CommentStateNotes
                  comment={comment}
                  locale={locale}
                  messages={messages}
                  timeZone={timeZone}
                />
              </div>
            </TableCell>
            <TableCell>
              <p className="text-sm whitespace-pre-wrap">{comment.body}</p>
            </TableCell>
            <TableCell>
              <div className="grid gap-0.5">
                <span className="font-medium">
                  {comment.authorName || comment.authorPublicId}
                </span>
                <span className="text-xs text-muted-foreground">
                  {comment.authorPublicId}
                </span>
              </div>
            </TableCell>
            <TableCell>
              <div className="grid gap-0.5">
                <Link
                  className="font-medium underline-offset-4 hover:underline"
                  href={`/series/${comment.seriesPublicId}/episodes/${comment.episodePublicId}`}
                >
                  {comment.episodeTitle || comment.episodePublicId}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {comment.seriesTitle || comment.seriesPublicId}
                </span>
              </div>
            </TableCell>
            <TableCell>
              {formatCommentDateTime(comment.createdAt, locale, timeZone)}
            </TableCell>
            <TableCell>
              <CommentRowActions comment={comment} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export const CommentManager = ({
  comments,
  listErrorMessage,
  locale,
  nextHref,
  pageSize,
  previousHref,
  timeZone,
}: CommentManagerProps) => {
  const messages = sharedCatalog(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  const showPagination =
    !listErrorMessage && (comments.length > 0 || hasPageLinks);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {getMessage(messages, "admin.comments.list_title")}
        </CardTitle>
        <CardDescription>
          {getMessage(messages, "admin.comments.list_description")}
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        <CommentListBody
          comments={comments}
          hasPageLinks={hasPageLinks}
          listErrorMessage={listErrorMessage}
          locale={locale}
          timeZone={timeZone}
        />

        {showPagination ? (
          <PaginationFooter
            ariaLabel={getMessage(messages, "admin.comments.pagination_aria")}
            description={getMessage(
              messages,
              "admin.comments.pagination_description",
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
