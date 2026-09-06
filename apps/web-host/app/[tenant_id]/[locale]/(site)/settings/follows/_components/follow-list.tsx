import { getMessage } from "@publira/i18n";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { formatDateTime } from "@publira/utils";

import { LocaleLink } from "#components/locale-link";
import type { FollowTargetKind } from "#lib/follow";
import type { FollowListItem } from "#lib/follow-list";
import { getLocale, loadHostMessages } from "#lib/locale";
import type { HostMessageKey } from "#lib/locale";

import { followsListHref } from "../_lib/search-params";
import { UnfollowButton } from "./unfollow-button";

const kindLabelKey: Record<FollowTargetKind, HostMessageKey> = {
  author: "host.settings.follows_kind_author",
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
 * The whole list resolves the catalog once, and the pieces that repeat — the
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
  const messages = await loadHostMessages(locale);
  const previousLabel = getMessage(messages, "host.common.previous_page");
  const nextLabel = getMessage(messages, "host.common.next_page");
  const returnTo = followsListHref(token);

  const pagination = (
    <nav
      aria-label={getMessage(messages, "host.settings.follows_pagination_aria")}
      className="mt-6 flex items-center justify-center gap-6"
    >
      {previousToken ? (
        <LocaleLink
          className="text-sm text-primary underline-offset-4 hover:underline"
          href={followsListHref(previousToken)}
        >
          {previousLabel}
        </LocaleLink>
      ) : (
        <span className="text-sm text-muted-foreground">{previousLabel}</span>
      )}
      {nextToken ? (
        <LocaleLink
          className="text-sm text-primary underline-offset-4 hover:underline"
          href={followsListHref(nextToken)}
        >
          {nextLabel}
        </LocaleLink>
      ) : (
        <span className="text-sm text-muted-foreground">{nextLabel}</span>
      )}
    </nav>
  );

  const emptyState = token ? (
    <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-5 text-center text-sm text-muted-foreground">
      <p>{getMessage(messages, "host.settings.follows_page_empty")}</p>
      {previousToken || nextToken ? (
        pagination
      ) : (
        <LocaleLink
          className="mt-4 inline-flex text-sm text-primary underline-offset-4 hover:underline"
          href={followsListHref("")}
        >
          {getMessage(messages, "host.settings.follows_first_page")}
        </LocaleLink>
      )}
    </div>
  ) : (
    <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-5 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">
        {getMessage(messages, "host.settings.follows_empty_title")}
      </p>
      <p className="mt-1">
        {getMessage(messages, "host.settings.follows_empty_description")}
      </p>
      <LocaleLink
        className="mt-4 inline-flex text-sm text-primary underline-offset-4 hover:underline"
        href="/series"
      >
        {getMessage(messages, "host.common.find_series")}
      </LocaleLink>
    </div>
  );

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">
          {getMessage(messages, "host.settings.follows_heading")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {getMessage(messages, "host.settings.follows_description")}
        </p>
      </div>

      {listErrorMessage ? (
        <SectionError>
          <SectionErrorHeading>
            <SectionErrorTitle>
              {getMessage(messages, "host.settings.follows_error")}
            </SectionErrorTitle>
            <SectionErrorDescription>
              {listErrorMessage}
            </SectionErrorDescription>
          </SectionErrorHeading>
        </SectionError>
      ) : null}

      {!listErrorMessage && items.length === 0 ? emptyState : null}

      {items.length > 0 ? (
        <div className="grid gap-3">
          {items.map((item) => (
            <article
              className="rounded-xl border border-border/70 bg-background p-4"
              key={`${item.targetKind}:${item.publicId}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {getMessage(messages, kindLabelKey[item.targetKind])}
                  </p>
                  <FollowTitle item={item} />
                  {item.unavailable ? (
                    <p className="text-sm text-muted-foreground">
                      {getMessage(
                        messages,
                        "host.settings.follows_unavailable"
                      )}
                    </p>
                  ) : null}
                </div>
                {item.unavailable ? null : (
                  <UnfollowButton
                    copy={{
                      ariaLabel: getMessage(
                        messages,
                        "host.follow.unfollow_aria",
                        { name: item.title }
                      ),
                      pending: getMessage(messages, "host.follow.pending"),
                      submit: getMessage(messages, "host.follow.unfollow"),
                    }}
                    publicId={item.publicId}
                    returnTo={returnTo}
                    targetKind={item.targetKind}
                    tenantId={tenantId}
                  />
                )}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {getMessage(messages, "host.settings.follows_followed_at")}{" "}
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
      ) : null}

      {!listErrorMessage && items.length > 0 ? pagination : null}
    </section>
  );
};
