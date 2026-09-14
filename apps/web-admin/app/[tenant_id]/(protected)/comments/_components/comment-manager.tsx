import type { Locale } from "@publira/i18n";
import { StatusChip } from "@publira/ui-components/badge";
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

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import { PaginationFooter } from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";

import type { CommentItem } from "../comment-types";
import { CommentActionButton } from "./comment-action-button";
import { CommentReasonDialog } from "./comment-reason-dialog";
import {
  commentStatusTone,
  CommentStatusMessage,
} from "./comment-status-label";

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
const PurgeNotice = ({
  comment,
  locale,
  timeZone,
}: {
  comment: CommentItem;
  locale: Locale;
  timeZone: string;
}) => {
  const at = formatCommentDateTime(comment.purgeDueAt, locale, timeZone);
  const days = daysUntilPurge(comment.purgeDueAt, timeZone);
  if (days === null || days <= 0) {
    return <Message message="admin.comments.purge_due_now" values={{ at }} />;
  }
  if (days === 1) {
    return (
      <Message message="admin.comments.purge_due_one_day" values={{ at }} />
    );
  }

  return (
    <Message message="admin.comments.purge_due_days" values={{ at, days }} />
  );
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
  timeZone,
}: {
  comment: CommentItem;
  locale: Locale;
  timeZone: string;
}) => {
  if (comment.status === "hidden") {
    return (
      <>
        <span className="text-xs text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-3 w-40" />}>
            {comment.hiddenReason === "auto_reports" ? (
              <Message message="admin.comments.hidden_by_reports" />
            ) : (
              <Message message="admin.comments.hidden_by_staff" />
            )}
          </Suspense>
        </span>
        <span className="text-xs text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="admin.comments.hidden_author_notice" />
          </Suspense>
        </span>
        <span className="text-xs text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message
              message="admin.comments.hidden_at"
              values={{
                at: formatCommentDateTime(comment.hiddenAt, locale, timeZone),
              }}
            />
          </Suspense>
        </span>
      </>
    );
  }

  if (comment.status === "withdrawn") {
    return (
      <>
        <span className="text-xs text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message
              message="admin.comments.withdrawn_by_author"
              values={{
                at: formatCommentDateTime(
                  comment.withdrawnAt,
                  locale,
                  timeZone
                ),
              }}
            />
          </Suspense>
        </span>
        <span className="text-xs text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-3 w-56" />}>
            <PurgeNotice
              comment={comment}
              locale={locale}
              timeZone={timeZone}
            />
          </Suspense>
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
  emptyDescription,
  emptyTitle,
  hasPageLinks,
  itemLabel,
  listErrorMessage,
  locale,
  timeZone,
}: {
  /** The empty state's copy, resolved by the async parent. */
  comments: CommentItem[];
  emptyDescription: string;
  emptyTitle: string;
  hasPageLinks: boolean;
  itemLabel: string;
  listErrorMessage?: string;
  locale: Locale;
  timeZone: string;
}) => {
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
        description={emptyDescription}
        hasPageLinks={hasPageLinks}
        itemLabel={itemLabel}
        title={emptyTitle}
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-56">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.comments.columns.status" />
            </Suspense>
          </TableHead>
          <TableHead>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.comments.columns.comment" />
            </Suspense>
          </TableHead>
          <TableHead className="w-48">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.comments.columns.author" />
            </Suspense>
          </TableHead>
          <TableHead className="w-56">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.comments.columns.episode" />
            </Suspense>
          </TableHead>
          <TableHead className="w-44">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.comments.columns.created_at" />
            </Suspense>
          </TableHead>
          <TableHead className="w-36">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.comments.columns.actions" />
            </Suspense>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {comments.map((comment) => (
          <TableRow key={comment.publicId}>
            <TableCell>
              <div className="grid gap-1">
                <StatusChip status={commentStatusTone(comment.status)}>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <CommentStatusMessage status={comment.status} />
                  </Suspense>
                </StatusChip>
                <CommentStateNotes
                  comment={comment}
                  locale={locale}
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

export const CommentManager = async ({
  comments,
  listErrorMessage,
  locale,
  nextHref,
  pageSize,
  previousHref,
  timeZone,
}: CommentManagerProps) => {
  const t = await getMessagesFor(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  const showPagination =
    !listErrorMessage && (comments.length > 0 || hasPageLinks);

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.comments.list_title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.comments.list_description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>

      <CommentListBody
        comments={comments}
        emptyDescription={t("admin.comments.empty_description")}
        emptyTitle={t("admin.comments.empty_title")}
        hasPageLinks={hasPageLinks}
        itemLabel={t("admin.comments.item_label")}
        listErrorMessage={listErrorMessage}
        locale={locale}
        timeZone={timeZone}
      />

      {showPagination ? (
        <PaginationFooter
          ariaLabel={t("admin.comments.pagination_aria")}
          description={t("admin.comments.pagination_description", {
            count: pageSize,
          })}
          nextHref={nextHref}
          previousHref={previousHref}
        />
      ) : null}
    </AdminSection>
  );
};
