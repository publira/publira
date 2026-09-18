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

import {
  CommentRowActions,
  CommentStateNotes,
  formatCommentDateTime,
} from "../../../comments/_components/comment-manager";
import {
  commentStatusTone,
  CommentStatusMessage,
} from "../../../comments/_components/comment-status-label";
import type { CommentItem } from "../../../comments/comment-types";

type ReaderCommentsProps = CursorPageHrefs & {
  comments: CommentItem[];
  listErrorMessage?: string;
  locale: Locale;
  pageSize: number;
  timeZone: string;
};

/**
 * The comments one reader wrote, with the moderation controls the comment
 * list offers, so a decision about the reader and about what they wrote can be
 * made without leaving the page. The commenter column is left out because
 * every row names the same person.
 */
export const ReaderComments = async ({
  comments,
  listErrorMessage,
  locale,
  nextHref,
  pageSize,
  previousHref,
  timeZone,
}: ReaderCommentsProps) => {
  const t = await getMessagesFor(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  const showPagination =
    !listErrorMessage && (comments.length > 0 || hasPageLinks);

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.readers.comments_title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.readers.comments_description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>

      {listErrorMessage ? (
        <SectionError>
          <SectionErrorHeading>
            <SectionErrorTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.readers.comments_error" />
              </Suspense>
            </SectionErrorTitle>
            <SectionErrorDescription>
              {listErrorMessage}
            </SectionErrorDescription>
          </SectionErrorHeading>
        </SectionError>
      ) : null}

      {!listErrorMessage && comments.length === 0 ? (
        <CursorPageEmptyState
          description={
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.readers.comments_empty_description" />
            </Suspense>
          }
          hasPageLinks={hasPageLinks}
          itemLabel={t("admin.comments.item_label")}
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.readers.comments_empty_title" />
            </Suspense>
          }
        />
      ) : null}

      {!listErrorMessage && comments.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-56">
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.comments.columns.status" />
                </Suspense>
              </TableHead>
              <TableHead>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.comments.columns.comment" />
                </Suspense>
              </TableHead>
              <TableHead className="w-56">
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.comments.columns.episode" />
                </Suspense>
              </TableHead>
              <TableHead className="w-44">
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.comments.columns.created_at" />
                </Suspense>
              </TableHead>
              <TableHead className="w-36">
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
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
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-16" />}
                      >
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
      ) : null}

      {showPagination ? (
        <PaginationFooter
          ariaLabel={t("admin.readers.comments_pagination_aria")}
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
