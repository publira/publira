import * as EmptyState from "@publira/ui-components/empty-state";
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
import { PageLoadError } from "#components/page-load-error";
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

const CreatorCommentsPageSkeleton = () => (
  <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <section className="border border-border bg-card p-6">
      <SkeletonLine className="h-4 w-32" />
      <SkeletonLine className="mt-2 h-6 w-40" />
    </section>
    <Skeleton className="h-64 w-full" />
  </div>
);

/**
 * What readers say about the Author's episodes, newest first, each comment
 * under the episode it was left on. Nothing here acts on a comment: the Author
 * answers one where every reader reads it, under the episode, and the page says
 * so above the list.
 */
const CreatorCommentsPageContent = async ({
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

  const { creator_id: creatorId } = parsed.data;
  const { token } = searchParamsSchema.parse(resolvedSearchParams);

  const [creators, result, timeZone, t] = await Promise.all([
    listMyCreators(tenantId, locale),
    listMyCreatorComments(tenantId, { creatorId, locale, token }),
    getTenantDisplayTimeZone(tenantId),
    getMessagesFor(locale),
  ]);

  const requiresSignIn = [creators, result].some(
    (read) => !read.ok && !read.missing && read.requiresSignIn
  );

  if (requiresSignIn) {
    await redirectToLogin(
      locale,
      creatorCommentsHref(creatorId, token),
      tenantId
    );
  }

  if ((!creators.ok && creators.missing) || (!result.ok && result.missing)) {
    notFound();
  }

  if (!creators.ok) {
    return <PageLoadError description={creators.message} />;
  }

  if (!result.ok) {
    return <PageLoadError description={result.message} />;
  }

  const creator = creators.value.creators.find(({ id }) => id === creatorId);

  if (!creator) {
    notFound();
  }

  const { comments, nextToken, previousToken } = result.value;

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="grid gap-4 border border-border bg-card p-6">
        <CreatorHeading creator={creator}>
          <p className="text-sm text-muted-foreground">{creator.name}</p>
          <h1 className="text-xl font-semibold">
            {t("storefront.my_creator.comments.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("storefront.my_creator.comments.description")}
          </p>
        </CreatorHeading>
      </section>

      <section className="grid gap-4 border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          {t("storefront.my_creator.comments.reply_hint")}
        </p>
        {comments.length === 0 ? (
          <EmptyState.Root>
            <EmptyState.Description>
              {token
                ? t("storefront.my_creator.comments.page_empty")
                : t("storefront.my_creator.comments.empty")}
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
                                {t("storefront.episode.comments.creator_badge")}
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
                previousToken
                  ? creatorCommentsHref(creatorId, previousToken)
                  : ""
              }
            >
              {t("storefront.common.previous_page")}
            </ListPagination.Step>
            <ListPagination.Step
              href={nextToken ? creatorCommentsHref(creatorId, nextToken) : ""}
            >
              {t("storefront.common.next_page")}
            </ListPagination.Step>
          </ListPagination.Root>
        ) : null}
      </section>

      <p>
        <LocaleLink
          className="text-sm text-primary underline underline-offset-4"
          href={creatorPageHref(creatorId)}
        >
          {t("storefront.my_creator.back_to_creator", { name: creator.name })}
        </LocaleLink>
      </p>
    </div>
  );
};

const CreatorCommentsPage = (props: CreatorCommentsPageProps) => (
  <Suspense fallback={<CreatorCommentsPageSkeleton />}>
    <CreatorCommentsPageContent {...props} />
  </Suspense>
);

export default CreatorCommentsPage;
