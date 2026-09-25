import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import {
  ListPagination,
  ListPaginationStep,
} from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import type { FollowTargetKind } from "#lib/follow";
import type { FollowListItem } from "#lib/follow-list";
import { getLocale } from "#lib/locale";
import type { HostMessageKey } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";

import { followsListHref } from "../_lib/search-params";
import { UnfollowButton } from "./unfollow-button";

const kindLabelKey: Record<FollowTargetKind, HostMessageKey> = {
  creator: "host.settings.follows_kind_creator",
  series: "host.settings.follows_kind_series",
};

interface FollowListProps {
  items: FollowListItem[];
  listErrorMessage?: string;
  nextToken: string;
  previousToken: string;
  tenantId: string;
  timeZone: string;
  token: string;
}

const FollowTitle = ({ item }: { item: FollowListItem }) => {
  const title = item.href ? (
    <LocaleLink className="hover:underline" href={item.href}>
      {item.title}
    </LocaleLink>
  ) : (
    item.title
  );

  return <h3 className="font-medium">{title}</h3>;
};

/**
 * The whole list resolves the accessor once, and the pieces that repeat — the
 * pager above all — are JSX values in this scope rather than components taking
 * a `messages` prop. The page renders this inside the section's own boundary,
 * so nothing here reaches the static shell.
 */
export const FollowList = async ({
  items,
  listErrorMessage,
  nextToken,
  previousToken,
  tenantId,
  timeZone,
  token,
}: FollowListProps) => {
  const locale = await getLocale();
  const t = await getMessagesFor(locale);
  const returnTo = followsListHref(token);

  const pagination = (
    <ListPagination aria-label={t("host.settings.follows_pagination_aria")}>
      <ListPaginationStep
        href={previousToken ? followsListHref(previousToken) : ""}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="host.common.previous_page" />
        </Suspense>
      </ListPaginationStep>
      <ListPaginationStep href={nextToken ? followsListHref(nextToken) : ""}>
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="host.common.next_page" />
        </Suspense>
      </ListPaginationStep>
    </ListPagination>
  );

  const emptyState = token ? (
    <div className="grid gap-6">
      <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-5 text-center text-sm text-muted-foreground">
        <p>{t("host.settings.follows_page_empty")}</p>
        {previousToken || nextToken ? null : (
          <LocaleLink
            className="mt-4 inline-flex text-sm text-primary underline-offset-4 hover:underline"
            href={followsListHref("")}
          >
            {t("host.settings.follows_first_page")}
          </LocaleLink>
        )}
      </div>
      {previousToken || nextToken ? pagination : null}
    </div>
  ) : (
    <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-5 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">
        {t("host.settings.follows_empty_title")}
      </p>
      <p className="mt-1">{t("host.settings.follows_empty_description")}</p>
      <LocaleLink
        className="mt-4 inline-flex text-sm text-primary underline-offset-4 hover:underline"
        href="/series"
      >
        {t("host.common.find_series")}
      </LocaleLink>
    </div>
  );

  return (
    <section className="border border-border bg-card p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">
          {t("host.settings.follows_heading")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("host.settings.follows_description")}
        </p>
      </div>

      {listErrorMessage ? (
        <SectionError>
          <SectionErrorHeading>
            <SectionErrorTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="host.settings.follows_error" />
              </Suspense>
            </SectionErrorTitle>
            <SectionErrorDescription>
              {listErrorMessage}
            </SectionErrorDescription>
          </SectionErrorHeading>
        </SectionError>
      ) : null}

      {!listErrorMessage && items.length === 0 ? emptyState : null}

      {items.length > 0 ? (
        <div className="grid gap-6">
          <div className="grid gap-3">
            {items.map((item) => (
              <article
                className="rounded-xl border border-border/70 bg-background p-4"
                key={`${item.targetKind}:${item.publicId}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {t(kindLabelKey[item.targetKind])}
                    </p>
                    <FollowTitle item={item} />
                    {item.unavailable ? (
                      <p className="text-sm text-muted-foreground">
                        {t("host.settings.follows_unavailable")}
                      </p>
                    ) : null}
                  </div>
                  {item.unavailable ? null : (
                    <UnfollowButton
                      aria-label={t("host.follow.unfollow_aria", {
                        name: item.title,
                      })}
                      publicId={item.publicId}
                      returnTo={returnTo}
                      targetKind={item.targetKind}
                      tenantId={tenantId}
                    />
                  )}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("host.settings.follows_followed_at")}{" "}
                  <time dateTime={item.followedAt}>
                    {formatDateTime(item.followedAt, {
                      fallback: "-",
                      locale,
                      timeZone,
                    })}
                  </time>
                </p>
              </article>
            ))}
          </div>
          {listErrorMessage ? null : pagination}
        </div>
      ) : null}
    </section>
  );
};
