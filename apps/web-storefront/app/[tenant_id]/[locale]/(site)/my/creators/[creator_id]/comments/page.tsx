import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import * as EpisodeComment from "#components/episode-comment";
import * as ListPagination from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLogin } from "#lib/auth-session";
import { episodeCommentDisplayName } from "#lib/comments";
import {
  creatorCommentsHref,
  creatorIdParamSchema,
  creatorPageHref,
} from "#lib/creator-page-paths";
import { listMyCreatorComments, listMyCreators } from "#lib/creator-pages";
import { cursorTokenSchema } from "#lib/cursor-token";
import { getMessages } from "#lib/get-messages";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantDisplayTimeZone } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { CreatorHeading } from "../../_components/creator-heading";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "creator_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getMessages();

  return { title: t("storefront.my_creator.comments.title") };
};

type CreatorCommentsPageProps =
  PageProps<"/[tenant_id]/[locale]/my/creators/[creator_id]/comments">;

const paramsSchema = z.object({ creator_id: creatorIdParamSchema });

const searchParamsSchema = z.object({ token: cursorTokenSchema });

const resolveRequest = async ({
  params,
  searchParams,
}: CreatorCommentsPageProps) => {
  const [rawParams, resolvedSearchParams, tenantId, locale] = await Promise.all(
    [params, searchParams, getTenantId(), getLocale()]
  );

  const parsed = paramsSchema.safeParse(rawParams);

  if (!parsed.success) {
    notFound();
  }

  const { token } = searchParamsSchema.parse(resolvedSearchParams);

  return { creatorId: parsed.data.creator_id, locale, tenantId, token };
};

/**
 * The Author the path names, out of those the account is linked to; any other
 * Author is not found. The heading and the back link both read it.
 */
const readCreator = async (props: CreatorCommentsPageProps) => {
  const { creatorId, locale, tenantId, token } = await resolveRequest(props);
  const result = await listMyCreators(tenantId, locale);

  if (!result.ok && result.missing) {
    notFound();
  }

  if (!result.ok) {
    if (result.requiresSignIn) {
      await redirectToLogin(
        locale,
        creatorCommentsHref(creatorId, token),
        tenantId
      );
    }

    return { message: result.message, ok: false as const };
  }

  const creator = result.value.creators.find(({ id }) => id === creatorId);

  if (!creator) {
    notFound();
  }

  return { ok: true as const, value: creator };
};

const CreatorCommentsAuthor = async (props: CreatorCommentsPageProps) => {
  const creator = await readCreator(props);

  if (!creator.ok) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="storefront.my_creator.load_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>{creator.message}</SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  return (
    <CreatorHeading creator={creator.value}>
      <p className="font-medium">{creator.value.name}</p>
    </CreatorHeading>
  );
};

const CreatorCommentsBackLink = async (props: CreatorCommentsPageProps) => {
  const creator = await readCreator(props);

  if (!creator.ok) {
    return null;
  }

  return (
    <LocaleLink
      className="text-sm text-primary underline underline-offset-4"
      href={creatorPageHref(creator.value.id)}
    >
      <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
        <Message
          message="storefront.my_creator.back_to_creator"
          values={{ name: creator.value.name }}
        />
      </Suspense>
    </LocaleLink>
  );
};

const CreatorCommentListSkeleton = () => (
  <div className="grid gap-4">
    <Skeleton className="h-28 w-full" />
    <Skeleton className="h-28 w-full" />
  </div>
);

/**
 * The comments on the Author's episodes, newest first, each under the episode
 * it was left on. Nothing here acts on a comment: the Author answers one where
 * every reader reads it, under the episode, and the page says so above the
 * list.
 */
const CreatorCommentList = async (props: CreatorCommentsPageProps) => {
  const { creatorId, locale, tenantId, token } = await resolveRequest(props);

  const [result, timeZone, t] = await Promise.all([
    listMyCreatorComments(tenantId, { creatorId, locale, token }),
    getTenantDisplayTimeZone(tenantId),
    getMessagesFor(locale),
  ]);

  if (!result.ok && result.missing) {
    notFound();
  }

  if (!result.ok) {
    if (result.requiresSignIn) {
      await redirectToLogin(
        locale,
        creatorCommentsHref(creatorId, token),
        tenantId
      );
    }

    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="storefront.my_creator.comments.load_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>{result.message}</SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  const { comments, nextToken, previousToken } = result.value;

  return (
    <>
      {comments.length === 0 ? (
        <EmptyState.Root>
          <EmptyState.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <Message
                message={
                  token
                    ? "storefront.my_creator.comments.page_empty"
                    : "storefront.my_creator.comments.empty"
                }
              />
            </Suspense>
          </EmptyState.Description>
        </EmptyState.Root>
      ) : (
        <ol className="divide-y divide-border">
          {comments.map(
            ({
              comment,
              episodePublicId,
              episodeTitle,
              seriesPublicId,
              seriesTitle,
            }) => (
              <li className="py-4 first:pt-0" key={comment.id}>
                <p className="text-xs text-muted-foreground">{seriesTitle}</p>
                <h2 className="mb-3 font-medium">
                  <LocaleLink
                    className="hover:underline"
                    href={`/series/${seriesPublicId}/episodes/${episodePublicId}`}
                  >
                    {episodeTitle}
                  </LocaleLink>
                </h2>
                <EpisodeComment.Root>
                  <EpisodeComment.Header>
                    <EpisodeComment.Author>
                      <EpisodeComment.Icon icon={comment.authorIcon} />
                      <EpisodeComment.Byline>
                        <EpisodeComment.Name>
                          {comment.creatorPublicId ? (
                            <EpisodeComment.CreatorLink
                              href={`/creators/${comment.creatorPublicId}`}
                            >
                              {episodeCommentDisplayName(comment)}
                            </EpisodeComment.CreatorLink>
                          ) : (
                            episodeCommentDisplayName(comment)
                          )}
                          {comment.creatorName ? (
                            <EpisodeComment.CreatorBadge>
                              <Suspense
                                fallback={<SkeletonLine className="h-3 w-12" />}
                              >
                                <Message message="storefront.episode.comments.creator_badge" />
                              </Suspense>
                            </EpisodeComment.CreatorBadge>
                          ) : null}
                        </EpisodeComment.Name>
                        <EpisodeComment.Meta>
                          <time dateTime={comment.createdAt}>
                            {formatDateTime(comment.createdAt, {
                              fallback: t("storefront.common.unset"),
                              locale,
                              timeZone,
                            })}
                          </time>
                        </EpisodeComment.Meta>
                      </EpisodeComment.Byline>
                    </EpisodeComment.Author>
                  </EpisodeComment.Header>
                  <EpisodeComment.Body>{comment.body}</EpisodeComment.Body>
                </EpisodeComment.Root>
              </li>
            )
          )}
        </ol>
      )}
      {previousToken || nextToken ? (
        <ListPagination.Root
          aria-label={t("storefront.my_creator.comments.pagination_aria")}
        >
          <ListPagination.Step
            href={
              previousToken ? creatorCommentsHref(creatorId, previousToken) : ""
            }
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="storefront.common.previous_page" />
            </Suspense>
          </ListPagination.Step>
          <ListPagination.Step
            href={nextToken ? creatorCommentsHref(creatorId, nextToken) : ""}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="storefront.common.next_page" />
            </Suspense>
          </ListPagination.Step>
        </ListPagination.Root>
      ) : null}
    </>
  );
};

const CreatorCommentsPage = (props: CreatorCommentsPageProps) => (
  <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <section className="grid gap-4 border border-border bg-card p-6">
      <Suspense fallback={<SkeletonLine className="h-14 w-48" />}>
        <CreatorCommentsAuthor {...props} />
      </Suspense>
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">
          <Suspense fallback={<SkeletonLine className="h-6 w-32" />}>
            <Message message="storefront.my_creator.comments.title" />
          </Suspense>
        </h1>
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="storefront.my_creator.comments.description" />
          </Suspense>
        </p>
      </div>
    </section>

    <section className="grid gap-4 border border-border bg-card p-6">
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
          <Message message="storefront.my_creator.comments.reply_hint" />
        </Suspense>
      </p>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="storefront.my_creator.comments.load_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<CreatorCommentListSkeleton />}>
          <CreatorCommentList {...props} />
        </Suspense>
      </SectionErrorBoundary>
    </section>

    <p>
      <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
        <CreatorCommentsBackLink {...props} />
      </Suspense>
    </p>
  </div>
);

export default CreatorCommentsPage;
