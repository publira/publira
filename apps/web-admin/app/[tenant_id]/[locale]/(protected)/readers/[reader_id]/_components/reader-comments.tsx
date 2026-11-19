import type { Locale } from "@publira/i18n";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { StatusChip } from "@publira/ui-components/badge";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import Link from "next/link";
import { Suspense } from "react";

import { CommentCreatorMark } from "#components/comment-creator-mark";
import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import * as PaginationFooter from "#components/pagination-controls";
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
  tenantId: string;
  timeZone: string;
};

/**
 * The comments one reader wrote, with the moderation controls the comment
 * list offers, so a decision about the reader and about what they wrote can be
 * made without leaving the page. The commenter column is left out because
 * every row names the same person; the credit they hold differs per episode,
 * so it stays on the row it is about.
 */
export const ReaderComments = async ({
  comments,
  listErrorMessage,
  locale,
  nextHref,
  pageSize,
  previousHref,
  tenantId,
  timeZone,
}: ReaderCommentsProps) => {
  const t = await getMessagesFor(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });

  const showPagination =
    !listErrorMessage && (comments.length > 0 || hasPageLinks);

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.readers.comments_title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.readers.comments_description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>

      {listErrorMessage ? (
        <SectionError.Root>
          <SectionError.Heading>
            <SectionError.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.readers.comments_error" />
              </Suspense>
            </SectionError.Title>
            <SectionError.Description>
              {listErrorMessage}
            </SectionError.Description>
          </SectionError.Heading>
        </SectionError.Root>
      ) : null}

      {!listErrorMessage && comments.length === 0 ? (
        <CursorPageEmptyState
          hasPageLinks={hasPageLinks}
          itemLabel={t("admin.comments.item_label")}
        >
          <EmptyState.Heading>
            <EmptyState.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.readers.comments_empty_title" />
              </Suspense>
            </EmptyState.Title>
            <EmptyState.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.readers.comments_empty_description" />
              </Suspense>
            </EmptyState.Description>
          </EmptyState.Heading>
        </CursorPageEmptyState>
      ) : null}

      {!listErrorMessage && comments.length > 0 ? (
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head className="w-56">
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.comments.columns.status" />
                </Suspense>
              </Table.Head>
              <Table.Head>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.comments.columns.comment" />
                </Suspense>
              </Table.Head>
              <Table.Head className="w-56">
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.comments.columns.episode" />
                </Suspense>
              </Table.Head>
              <Table.Head className="w-44">
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.comments.columns.created_at" />
                </Suspense>
              </Table.Head>
              <Table.Head className="w-36">
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.comments.columns.actions" />
                </Suspense>
              </Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {comments.map((comment) => (
              <Table.Row key={comment.id}>
                <Table.Cell>
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
                </Table.Cell>
                <Table.Cell>
                  <div className="grid gap-1">
                    <p className="text-sm whitespace-pre-wrap">
                      {comment.body}
                    </p>
                    <CommentCreatorMark creator={comment.creator} />
                  </div>
                </Table.Cell>
                <Table.Cell>
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
                </Table.Cell>
                <Table.Cell>
                  {formatCommentDateTime(comment.createdAt, locale, timeZone)}
                </Table.Cell>
                <Table.Cell>
                  <CommentRowActions comment={comment} tenantId={tenantId} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      ) : null}

      {showPagination ? (
        <PaginationFooter.Root>
          <PaginationFooter.Description>
            {t("admin.comments.pagination_description", {
              count: pageSize,
            })}
          </PaginationFooter.Description>
          <PaginationFooter.Controls
            aria-label={t("admin.readers.comments_pagination_aria")}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        </PaginationFooter.Root>
      ) : null}
    </ConsoleSection.Root>
  );
};
