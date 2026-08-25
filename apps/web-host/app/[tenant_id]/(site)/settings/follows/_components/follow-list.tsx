import { SectionError } from "@publira/ui-components/section-error";
import { formatDateTime } from "@publira/utils";
import Link from "next/link";

import type { FollowTargetKind } from "#lib/follow";
import type { FollowListItem } from "#lib/follow-list";

import { followsListHref } from "../_lib/search-params";
import { UnfollowButton } from "./unfollow-button";

const kindLabel: Record<FollowTargetKind, string> = {
  author: "著者",
  series: "作品",
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

const FollowsPagination = ({
  nextToken,
  previousToken,
}: {
  nextToken: string;
  previousToken: string;
}) => (
  <nav
    aria-label="フォロー一覧ページング"
    className="mt-6 flex items-center justify-center gap-6"
  >
    {previousToken ? (
      <Link
        className="text-sm text-primary underline-offset-4 hover:underline"
        href={followsListHref(previousToken)}
      >
        前のページ
      </Link>
    ) : (
      <span className="text-sm text-muted-foreground">前のページ</span>
    )}
    {nextToken ? (
      <Link
        className="text-sm text-primary underline-offset-4 hover:underline"
        href={followsListHref(nextToken)}
      >
        次のページ
      </Link>
    ) : (
      <span className="text-sm text-muted-foreground">次のページ</span>
    )}
  </nav>
);

const FollowsEmptyState = ({
  nextToken,
  previousToken,
  token,
}: {
  nextToken: string;
  previousToken: string;
  token: string;
}) => {
  if (!token) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-5 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">
          フォロー中の作品・著者はありません。
        </p>
        <p className="mt-1">
          公開中の作品や著者をフォローすると、ここに表示されます。非公開になった対象は一覧から外れます。
        </p>
        <Link
          className="mt-4 inline-flex text-sm text-primary underline-offset-4 hover:underline"
          href="/series"
        >
          シリーズを探す
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-5 text-center text-sm text-muted-foreground">
      <p>このページに表示できるフォローはありません。</p>
      {previousToken || nextToken ? (
        <FollowsPagination
          nextToken={nextToken}
          previousToken={previousToken}
        />
      ) : (
        <Link
          className="mt-4 inline-flex text-sm text-primary underline-offset-4 hover:underline"
          href={followsListHref("")}
        >
          フォロー一覧の先頭へ
        </Link>
      )}
    </div>
  );
};

const FollowTitle = ({ item }: { item: FollowListItem }) => {
  const title = item.href ? (
    <Link className="hover:underline" href={item.href}>
      {item.title}
    </Link>
  ) : (
    item.title
  );

  return <h3 className="font-medium">{title}</h3>;
};

const FollowCard = ({
  item,
  returnTo,
  tenantId,
  timeZone,
}: {
  item: FollowListItem;
  returnTo: string;
  tenantId: string;
  timeZone: string;
}) => (
  <article className="rounded-xl border border-border/70 bg-background p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          {kindLabel[item.targetKind]}
        </p>
        <FollowTitle item={item} />
        {item.unavailable ? (
          <p className="text-sm text-muted-foreground">
            非公開になった対象は一覧から外れます。
          </p>
        ) : null}
      </div>
      {item.unavailable ? null : (
        <UnfollowButton
          publicId={item.publicId}
          returnTo={returnTo}
          targetKind={item.targetKind}
          targetName={item.title}
          tenantId={tenantId}
        />
      )}
    </div>
    <p className="mt-3 text-xs text-muted-foreground">
      フォロー日時{" "}
      <time dateTime={item.followedAt}>
        {formatDateTime(item.followedAt, { fallback: "-", timeZone })}
      </time>
    </p>
  </article>
);

export const FollowList = ({
  items,
  listErrorMessage,
  nextToken,
  previousToken,
  tenantId,
  timeZone,
  token,
}: FollowListProps) => (
  <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
    <div className="mb-4">
      <h2 className="text-lg font-semibold">フォロー中の作品・著者</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        フォローしている作品と著者を確認し、公開ページへ移動するか、フォローを解除できます。
      </p>
    </div>

    {listErrorMessage ? (
      <SectionError
        description={listErrorMessage}
        title="フォロー一覧を表示できませんでした"
      />
    ) : null}

    {!listErrorMessage && items.length === 0 ? (
      <FollowsEmptyState
        nextToken={nextToken}
        previousToken={previousToken}
        token={token}
      />
    ) : null}

    {items.length > 0 ? (
      <div className="grid gap-3">
        {items.map((item) => (
          <FollowCard
            item={item}
            key={`${item.targetKind}:${item.publicId}`}
            returnTo={followsListHref(token)}
            tenantId={tenantId}
            timeZone={timeZone}
          />
        ))}
      </div>
    ) : null}

    {!listErrorMessage && items.length > 0 ? (
      <FollowsPagination nextToken={nextToken} previousToken={previousToken} />
    ) : null}
  </section>
);
