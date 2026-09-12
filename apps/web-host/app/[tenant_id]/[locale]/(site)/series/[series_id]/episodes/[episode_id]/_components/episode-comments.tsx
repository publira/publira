import { getMessage } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import {
  EmptyState,
  EmptyStateDescription,
} from "@publira/ui-components/empty-state";
import { Field, FieldLabel } from "@publira/ui-components/field";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Textarea } from "@publira/ui-components/textarea";
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "#components/action-form";
import {
  ListPagination,
  ListPaginationStep,
} from "#components/list-pagination";
import { LocaleField } from "#components/locale-field";
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
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantDisplayTimeZone } from "#lib/tenant";

import { episodeLoginHref } from "../_lib/access-gate";
import { postEpisodeCommentAction } from "../_lib/comment-actions";
import { episodeCommentsHref } from "../_lib/comment-search-params";
import { CommentDeleteButton } from "./comment-delete-button";
import { CommentReportButton } from "./comment-report-button";
import type { CommentReportButtonCopy } from "./comment-report-button";

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
 * same wording around it — because telling the author is a decision the
 * platform deliberately does not make (`proto/publira/v1/comment.proto`).
 *
 * A series that has not turned commenting on gets nothing at all rather than
 * an empty section: the resolved setting answers "does this series take
 * comments", and an empty list would read as "nobody has commented yet".
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
  const [messages, timeZone, viewer] = await Promise.all([
    loadHostMessages(locale),
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
    <ListPagination
      aria-label={getMessage(messages, "host.episode.comments.pagination_aria")}
    >
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
      fallback: getMessage(messages, "host.common.unset"),
      locale,
      timeZone,
    });

  // The report dialog says the same thing on every row, so it is resolved once
  // here rather than per comment. Each reason is looked up by its own key so
  // the catalog checks it, which a key built from the reason would not be.
  const reportCopy: CommentReportButtonCopy = {
    cancel: getMessage(messages, "host.common.cancel"),
    confirm: getMessage(messages, "host.episode.comments.report_confirm"),
    description: getMessage(
      messages,
      "host.episode.comments.report_description"
    ),
    noteLabel: getMessage(messages, "host.episode.comments.report_note_label"),
    notePlaceholder: getMessage(
      messages,
      "host.episode.comments.report_note_placeholder"
    ),
    pending: getMessage(messages, "host.episode.comments.reporting"),
    reasonLabel: getMessage(
      messages,
      "host.episode.comments.report_reason_label"
    ),
    reasons: {
      abuse: getMessage(messages, "host.episode.comments.report_reason_abuse"),
      other: getMessage(messages, "host.episode.comments.report_reason_other"),
      spam: getMessage(messages, "host.episode.comments.report_reason_spam"),
      spoiler: getMessage(
        messages,
        "host.episode.comments.report_reason_spoiler"
      ),
    },
    submit: getMessage(messages, "host.episode.comments.report"),
    title: getMessage(messages, "host.episode.comments.report_title"),
  };

  return (
    <section className="grid gap-4" id="comments">
      <div className="grid gap-1">
        <h2 className="border-b border-border pb-2 font-serif text-xl leading-tight">
          <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
            <Message message="host.episode.comments.title" />
          </Suspense>
        </h2>
        {commentMode === "approval_required" ? (
          <p className="text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="host.episode.comments.approval_notice" />
            </Suspense>
          </p>
        ) : null}
      </div>

      {viewer ? (
        <ActionForm
          action={postEpisodeCommentAction}
          className="grid max-w-(--measure-prose) gap-3"
        >
          <LocaleField />
          <input name="episodePublicId" type="hidden" value={episodePublicId} />
          <input name="returnTo" type="hidden" value={episodePath} />
          <input name="tenantId" type="hidden" value={tenantId} />
          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                <Message message="host.episode.comments.body_label" />
              </Suspense>
            </FieldLabel>
            {/* No `maxLength`: it counts UTF-16 code units, while the API
                counts Unicode code points, so it would cut an emoji-heavy
                comment off at half the length the server allows. The Action
                checks the real limit and says so next to the box. */}
            <Textarea
              name="body"
              placeholder={getMessage(
                messages,
                "host.episode.comments.body_placeholder"
              )}
              rows={4}
            />
          </Field>
          <ActionFormSubmit className="justify-self-start">
            <ActionFormIdle>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="host.episode.comments.submit" />
              </Suspense>
            </ActionFormIdle>
            <ActionFormPending>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="host.episode.comments.posting" />
              </Suspense>
            </ActionFormPending>
          </ActionFormSubmit>
        </ActionForm>
      ) : (
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
      )}

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
        <ol className="divide-y divide-border border-t border-border">
          {comments.map((comment) => (
            <li className="py-4" key={comment.publicId}>
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
                    commentPublicId={comment.publicId}
                    copy={{
                      ariaLabel: getMessage(
                        messages,
                        "host.episode.comments.delete_aria",
                        { date: commentedAt(comment) }
                      ),
                      pending: getMessage(
                        messages,
                        "host.episode.comments.deleting"
                      ),
                      submit: getMessage(
                        messages,
                        "host.episode.comments.delete"
                      ),
                    }}
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
                    ariaLabel={getMessage(
                      messages,
                      "host.episode.comments.report_aria",
                      {
                        author: comment.authorName,
                        date: commentedAt(comment),
                      }
                    )}
                    commentPublicId={comment.publicId}
                    copy={reportCopy}
                    returnTo={episodePath}
                    tenantId={tenantId}
                  />
                ) : null}
              </div>
              <p className="mt-3 max-w-(--measure-prose) text-sm whitespace-pre-wrap">
                {comment.body}
              </p>
            </li>
          ))}
        </ol>
      ) : null}

      {publicResult.ok && (page.previousToken || page.nextToken)
        ? pagination
        : null}
    </section>
  );
};
