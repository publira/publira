import { getMessage } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
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
import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { getMe } from "#lib/auth";
import {
  listEpisodeComments,
  listMyEpisodeComments,
  mergeOwnEpisodeComments,
} from "#lib/comments";
import type { EpisodeCommentItem } from "#lib/comments";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantCommentMode, getTenantDisplayTimeZone } from "#lib/tenant";

import { episodeLoginHref } from "../_lib/access-gate";
import { postEpisodeCommentAction } from "../_lib/comment-actions";
import { episodeCommentsHref } from "../_lib/comment-search-params";
import { CommentDeleteButton } from "./comment-delete-button";

export interface EpisodeCommentsProps {
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
 * A tenant that has not turned commenting on gets nothing at all rather than
 * an empty section: the setting answers "does this site take comments", and an
 * empty list would read as "nobody has commented yet".
 */
export const EpisodeComments = async ({
  episodePublicId,
  seriesPublicId,
  tenantId,
  token,
}: EpisodeCommentsProps) => {
  const commentMode = await getTenantCommentMode(tenantId);
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

  const previousLabel = getMessage(messages, "host.common.previous_page");
  const nextLabel = getMessage(messages, "host.common.next_page");
  const pagination = (
    <nav
      aria-label={getMessage(messages, "host.episode.comments.pagination_aria")}
      className="mt-6 flex items-center justify-center gap-6"
    >
      {page.previousToken ? (
        <LocaleLink
          className="text-sm text-primary underline-offset-4 hover:underline"
          href={episodeCommentsHref(episodePath, page.previousToken)}
        >
          {previousLabel}
        </LocaleLink>
      ) : (
        <span className="text-sm text-muted-foreground">{previousLabel}</span>
      )}
      {page.nextToken ? (
        <LocaleLink
          className="text-sm text-primary underline-offset-4 hover:underline"
          href={episodeCommentsHref(episodePath, page.nextToken)}
        >
          {nextLabel}
        </LocaleLink>
      ) : (
        <span className="text-sm text-muted-foreground">{nextLabel}</span>
      )}
    </nav>
  );

  const commentedAt = (comment: EpisodeCommentItem) =>
    formatDateTime(comment.createdAt, {
      fallback: getMessage(messages, "host.common.unset"),
      locale,
      timeZone,
    });

  return (
    <section
      className="rounded-3xl border border-border/70 bg-card p-6 shadow-sm sm:p-8"
      id="comments"
    >
      <h2 className="text-lg font-semibold">
        {getMessage(messages, "host.episode.comments.title")}
      </h2>
      {commentMode === "approval_required" ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {getMessage(messages, "host.episode.comments.approval_notice")}
        </p>
      ) : null}

      {viewer ? (
        <ActionForm
          action={postEpisodeCommentAction}
          className="mt-6 grid gap-3"
        >
          <LocaleField />
          <input name="episodePublicId" type="hidden" value={episodePublicId} />
          <input name="returnTo" type="hidden" value={episodePath} />
          <input name="tenantId" type="hidden" value={tenantId} />
          <Field>
            <FieldLabel>
              {getMessage(messages, "host.episode.comments.body_label")}
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
        <p className="mt-6 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          {getMessage(messages, "host.episode.comments.sign_in_prompt")}
          <LinkButton
            render={
              <LocaleLink
                href={episodeLoginHref(seriesPublicId, episodePublicId)}
              />
            }
            variant="outline"
          >
            {getMessage(messages, "host.episode.comments.sign_in")}
          </LinkButton>
        </p>
      )}

      {publicResult.ok ? null : (
        <SectionError className="mt-6">
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
        <SectionError className="mt-6">
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
        <p className="mt-6 rounded-xl border border-dashed border-border/70 bg-muted/20 p-5 text-sm text-muted-foreground">
          {getMessage(
            messages,
            token
              ? "host.episode.comments.page_empty"
              : "host.episode.comments.empty"
          )}
        </p>
      ) : null}

      {comments.length > 0 ? (
        <ol className="mt-6 grid gap-3">
          {comments.map((comment) => (
            <li
              className="rounded-xl border border-border/70 bg-background p-4"
              key={comment.publicId}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{comment.authorName}</p>
                  <p className="text-xs text-muted-foreground">
                    <time dateTime={comment.createdAt}>
                      {commentedAt(comment)}
                    </time>
                    {comment.awaitingApproval ? (
                      <span className="ml-2 rounded-full bg-warning/15 px-2 py-0.5 font-medium text-warning">
                        {getMessage(
                          messages,
                          "host.episode.comments.awaiting_approval"
                        )}
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
              </div>
              <p className="mt-3 text-sm whitespace-pre-wrap">{comment.body}</p>
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
