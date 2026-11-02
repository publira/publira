import { LinkButton } from "@publira/ui-components/button";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import * as EpisodeComment from "#components/episode-comment";
import * as ListPagination from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { getMe } from "#lib/auth";
import type { SeriesCommentMode } from "#lib/catalog";
import {
  episodeCommentDisplayName,
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
  episodeId: string;
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
 * Each comment is drawn by `EpisodeComment`, which says how a creator's comment
 * is marked.
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
  episodeId,
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
    listEpisodeComments(tenantId, {
      episodeId,
      episodePublicId,
      locale,
      token,
    }),
    viewer
      ? listMyEpisodeComments(tenantId, {
          author: viewer,
          episodeId,
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
    <ListPagination.Root
      aria-label={t("storefront.episode.comments.pagination_aria")}
    >
      <ListPagination.Step
        href={
          page.previousToken
            ? episodeCommentsHref(episodePath, page.previousToken)
            : ""
        }
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="storefront.common.previous_page" />
        </Suspense>
      </ListPagination.Step>
      <ListPagination.Step
        href={
          page.nextToken ? episodeCommentsHref(episodePath, page.nextToken) : ""
        }
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="storefront.common.next_page" />
        </Suspense>
      </ListPagination.Step>
    </ListPagination.Root>
  );

  const commentedAt = (comment: EpisodeCommentItem) =>
    formatDateTime(comment.createdAt, {
      fallback: t("storefront.common.unset"),
      locale,
      timeZone,
    });

  return (
    <EpisodeCommentDialog
      episodeId={episodeId}
      episodePublicId={episodePublicId}
      initialOpen={Boolean(token)}
      prompt={
        viewer ? undefined : (
          <p className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
              <Message message="storefront.episode.comments.sign_in_prompt" />
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
                <Message message="storefront.episode.comments.sign_in" />
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
            <Message message="storefront.episode.comments.approval_notice" />
          </Suspense>
        </p>
      ) : null}

      {publicResult.ok ? null : (
        <SectionError.Root>
          <SectionError.Heading>
            <SectionError.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="storefront.episode.comments.list_error" />
              </Suspense>
            </SectionError.Title>
            <SectionError.Description>
              {publicResult.message}
            </SectionError.Description>
          </SectionError.Heading>
        </SectionError.Root>
      )}
      {/* A failed per-viewer read is reported next to a list that still shows
          the public comments: silently dropping those rows would take the
          reader's own pending comment off the page with nothing saying so. */}
      {ownResult.ok ? null : (
        <SectionError.Root>
          <SectionError.Heading>
            <SectionError.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="storefront.episode.comments.own_error" />
              </Suspense>
            </SectionError.Title>
            <SectionError.Description>
              {ownResult.message}
            </SectionError.Description>
          </SectionError.Heading>
        </SectionError.Root>
      )}

      {publicResult.ok && comments.length === 0 ? (
        <EmptyState.Root>
          <EmptyState.Description>
            <Suspense fallback={<SkeletonLine className="mx-auto h-4 w-56" />}>
              {token ? (
                <Message message="storefront.episode.comments.page_empty" />
              ) : (
                <Message message="storefront.episode.comments.empty" />
              )}
            </Suspense>
          </EmptyState.Description>
        </EmptyState.Root>
      ) : null}

      {comments.length > 0 ? (
        <ol className="divide-y divide-border">
          {comments.map((comment) => (
            <li className="py-4 first:pt-0" key={comment.id}>
              <EpisodeComment.Root>
                <EpisodeComment.Header>
                  <EpisodeComment.Author comment={comment}>
                    <time dateTime={comment.createdAt}>
                      {commentedAt(comment)}
                    </time>
                    {comment.awaitingApproval ? (
                      <span className="ml-3 text-warning">
                        <Suspense
                          fallback={<SkeletonLine className="h-3 w-28" />}
                        >
                          <Message message="storefront.episode.comments.awaiting_approval" />
                        </Suspense>
                      </span>
                    ) : null}
                  </EpisodeComment.Author>
                  {viewer && comment.authorPublicId === viewer.publicId ? (
                    <CommentDeleteButton
                      aria-label={t("storefront.episode.comments.delete_aria", {
                        date: commentedAt(comment),
                      })}
                      commentId={comment.id}
                      episodePublicId={episodePublicId}
                      returnTo={episodePath}
                      tenantId={tenantId}
                    />
                  ) : null}
                  {/* Reporting needs a session, and a reader reporting their
                      own comment is the one case the API refuses outright —
                      they can delete it instead. */}
                  {viewer && comment.authorPublicId !== viewer.publicId ? (
                    <CommentReportButton
                      aria-label={t("storefront.episode.comments.report_aria", {
                        author: episodeCommentDisplayName(comment),
                        date: commentedAt(comment),
                      })}
                      commentId={comment.id}
                      returnTo={episodePath}
                      tenantId={tenantId}
                    />
                  ) : null}
                </EpisodeComment.Header>
                <EpisodeComment.Body>{comment.body}</EpisodeComment.Body>
              </EpisodeComment.Root>
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
