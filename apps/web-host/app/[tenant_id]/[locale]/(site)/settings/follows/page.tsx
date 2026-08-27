import type { Metadata } from "next";
import { Suspense } from "react";

import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLogin } from "#lib/auth-session";
import { listMyFollows, resolveFollowListItems } from "#lib/follow-list";
import { getLocale } from "#lib/locale";
import { getTenantDisplayTimeZone } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { FollowList } from "./_components/follow-list";
import {
  defaultFollowsPageSize,
  followsListHref,
  parseFollowsSearchParams,
} from "./_lib/search-params";

export const metadata: Metadata = {
  title: "フォロー",
};

type FollowsPageProps = PageProps<"/[tenant_id]/[locale]/settings/follows">;

const FollowListSkeleton = () => (
  <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
    <h2 className="mb-4 text-lg font-semibold">フォロー中の作品・著者</h2>
    <div className="h-24 w-full animate-pulse rounded-md bg-muted" />
  </section>
);

const FollowListData = async ({
  searchParams,
}: Pick<FollowsPageProps, "searchParams">) => {
  const [resolvedSearchParams, tenantId, locale] = await Promise.all([
    searchParams,
    getTenantId(),
    getLocale(),
  ]);
  const { token } = parseFollowsSearchParams(resolvedSearchParams);
  const [listResult, timeZone] = await Promise.all([
    listMyFollows(tenantId, {
      limit: defaultFollowsPageSize,
      token,
    }),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!listResult.ok && listResult.requiresSignIn) {
    redirectToLogin(locale, followsListHref(token));
  }

  const items = listResult.ok
    ? await resolveFollowListItems(tenantId, listResult.follows, locale)
    : [];

  return (
    <FollowList
      items={items}
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      nextToken={listResult.nextToken}
      previousToken={listResult.previousToken}
      tenantId={tenantId}
      timeZone={timeZone}
      token={token}
    />
  );
};

const FollowsSettingsPage = ({ searchParams }: FollowsPageProps) => (
  <div className="space-y-6">
    <SectionErrorBoundary title="フォロー一覧を表示できませんでした">
      <Suspense fallback={<FollowListSkeleton />}>
        <FollowListData searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </div>
);

export default FollowsSettingsPage;
