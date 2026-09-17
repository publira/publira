import { LinkButton } from "@publira/ui-components/button";
import {
  EmptyState,
  EmptyStateDescription,
} from "@publira/ui-components/empty-state";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import {
  ListPagination,
  ListPaginationStep,
} from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { getMe } from "#lib/auth";
import type { SeriesCommentMode } from "#lib/catalog";
import {
  listEpisodeComments,
  listMyEpisodeComments,
  mergeOwnEpisodeComments,
} from "#lib/comments";
import type { EpisodeCommentItem } from "#lib/comments";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantDisplayTimeZone } from "#lib/tenant";

import { episodeLoginHref } from "../_lib/access-gate";
import { episodeCommentsHref } from "../_lib/comment-search-params";
import { CommentDeleteButton } from "./comment-delete-button";
import { CommentReportButton } from "./comment-report-button";
import { EpisodeCommentDialog } from "./episode-comment-dialog";

/** The control that opens the comments, at the size it takes. */
export const EpisodeCommentsSkeleton = () => <Skeleton className="h-9 w-32" />;

export interface EpisodeCommentsProps {
  /** The series' resolved comment mode from GetSeriesDetail. */
  commentMode: SeriesCommentMode;
  episodePublicId: string;
  seriesPublicId: string;
  tenantId: string;
  /** Cursor of the comment page being shown. Empty on the newest page. */
  token: string;
}

/**
 * The episode's comment section: the published list every reader sees, with
 * the viewer's own comments the public list cannot carry folded into it.
 *
 * The two reads are deliberately separate. The public one is shared and cached
 * for everyone; the per-viewer one is keyed to a session, so no reader's
 * pending or removed comment can enter an entry another reader is served.
 *
 * Nothing here marks a comment as removed. A comment staff took down keeps
 * rendering to its author exactly as it did before — same place in the list,
 * same wording around it — because the removal reaches them as a notification
 * rather than as the comment changing shape under them.
 *
 * A series that has not turned commenting on gets nothing at all rather than
 * an empty section: the resolved setting answers "does this series take
 * comments", and an empty list would read as "nobody has commented yet".
 *
 * It is drawn as the page after the last page of the episode, so a comment
 * about the ending only reaches a reader who has read it, and the comments
 * themselves open from there in a dialog — that page is one screen of the
 * reader and no taller, while the list is as long as the episode is talked
 * about.
 */
export const EpisodeComments = async ({
  commentMode,
  episodePublicId,
  seriesPublicId,
  tenantId,
  token,
}: EpisodeCommentsProps) => {
  if (commentMode === "disabled") {
    return null;
  }

  const locale = await getLocale();
  const [t, timeZone, viewer] = await Promise.all([
    getMessagesFor(locale),
    getTenantDisplayTimeZone(tenantId),
    getMe(tenantId),
  ]);
  const episodePath = `/series/${seriesPublicId}/episodes/${episodePublicId}`;

  const [publicResult, ownResult] = await Promise.all([
    listEpisodeComments(tenantId, { episodePublicId, locale, token }),
    viewer
      ? listMyEpisodeComments(tenantId, {
          author: viewer,
          episodePublicId,
          locale,
        })
      : Promise.resolve({ ok: true as const, value: [] }),
  ]);

  const page = publicResult.ok
    ? publicResult.value
    : { comments: [], nextToken: "", previousToken: "" };
  const ownComments = ownResult.ok ? ownResult.value : [];
  const comments = mergeOwnEpisodeComments(page, ownComments);

  const pagination = (
    <ListPagination aria-label={t("host.episode.comments.pagination_aria")}>
      <ListPaginationStep
        href={
          page.previousToken
            ? episodeCommentsHref(episodePath, page.previousToken)
            : ""
        }
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="host.common.previous_page" />
        </Suspense>
      </ListPaginationStep>
      <ListPaginationStep
        href={
          page.nextToken ? episodeCommentsHref(episodePath, page.nextToken) : ""
        }
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="host.common.next_page" />
        </Suspense>
      </ListPaginationStep>
    </ListPagination>
  );

  const commentedAt = (comment: EpisodeCommentItem) =>
    formatDateTime(comment.createdAt, {
      fallback: t("host.common.unset"),
      locale,
      timeZone,
    });

  return (
    <EpisodeCommentDialog
      episodePublicId={episodePublicId}
      initialOpen={Boolean(token)}
      prompt={
        viewer ? undefined : (
          <p className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
              <Message message="host.episode.comments.sign_in_prompt" />
            </Suspense>
            <LinkButton
              render={
                <LocaleLink
                  href={episodeLoginHref(seriesPublicId, episodePublicId)}
                />
              }
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="host.episode.comments.sign_in" />
              </Suspense>
            </LinkButton>
          </p>
        )
      }
      returnTo={episodePath}
      tenantId={tenantId}
    >
      {commentMode === "approval_required" ? (
        <p className="pb-4 text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="host.episode.comments.approval_notice" />
          </Suspense>
        </p>
      ) : null}

      {publicResult.ok ? null : (
        <SectionError>
          <SectionErrorHeading>
            <SectionErrorTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="host.episode.comments.list_error" />
              </Suspense>
            </SectionErrorTitle>
            <SectionErrorDescription>
              {publicResult.message}
            </SectionErrorDescription>
          </SectionErrorHeading>
        </SectionError>
      )}
      {/* A failed per-viewer read is reported next to a list that still shows
          the public comments: silently dropping those rows would take the
          reader's own pending comment off the page with nothing saying so. */}
      {ownResult.ok ? null : (
        <SectionError>
          <SectionErrorHeading>
            <SectionErrorTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="host.episode.comments.own_error" />
              </Suspense>
            </SectionErrorTitle>
            <SectionErrorDescription>
              {ownResult.message}
            </SectionErrorDescription>
          </SectionErrorHeading>
        </SectionError>
      )}

      {publicResult.ok && comments.length === 0 ? (
        <EmptyState>
          <EmptyStateDescription>
            <Suspense fallback={<SkeletonLine className="mx-auto h-4 w-56" />}>
              {token ? (
                <Message message="host.episode.comments.page_empty" />
              ) : (
                <Message message="host.episode.comments.empty" />
              )}
            </Suspense>
          </EmptyStateDescription>
        </EmptyState>
      ) : null}

      {comments.length > 0 ? (
        <ol className="divide-y divide-border">
          {comments.map((comment) => (
            <li className="py-4 first:pt-0" key={comment.publicId}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{comment.authorName}</p>
                  <p className="text-xs text-muted-foreground">
                    <time dateTime={comment.createdAt}>
                      {commentedAt(comment)}
                    </time>
                    {comment.awaitingApproval ? (
                      <span className="ml-3 text-warning">
                        <Suspense
                          fallback={<SkeletonLine className="h-3 w-28" />}
                        >
                          <Message message="host.episode.comments.awaiting_approval" />
                        </Suspense>
                      </span>
                    ) : null}
                  </p>
                </div>
                {viewer && comment.authorPublicId === viewer.publicId ? (
                  <CommentDeleteButton
                    commentedAt={commentedAt(comment)}
                    commentPublicId={comment.publicId}
                    episodePublicId={episodePublicId}
                    returnTo={episodePath}
                    tenantId={tenantId}
                  />
                ) : null}
                {/* Reporting needs a session, and a reader reporting their own
                    comment is the one case the API refuses outright — they can
                    delete it instead. */}
                {viewer && comment.authorPublicId !== viewer.publicId ? (
                  <CommentReportButton
                    authorName={comment.authorName}
                    commentedAt={commentedAt(comment)}
                    commentPublicId={comment.publicId}
                    returnTo={episodePath}
                    tenantId={tenantId}
                  />
                ) : null}
              </div>
              <p className="mt-3 text-sm whitespace-pre-wrap">{comment.body}</p>
            </li>
          ))}
        </ol>
      ) : null}

      {publicResult.ok && (page.previousToken || page.nextToken)
        ? pagination
        : null}
    </EpisodeCommentDialog>
  );
};
