import { getMessage } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLogin } from "#lib/auth-session";
import { listMyFollows, resolveFollowListItems } from "#lib/follow-list";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantDisplayTimeZone } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { FollowList } from "./_components/follow-list";
import {
  defaultFollowsPageSize,
  followsListHref,
  parseFollowsSearchParams,
} from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.settings.tab_follows") };
};

type FollowsPageProps = PageProps<"/[tenant_id]/[locale]/settings/follows">;

const FollowListSkeleton = () => (
  <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
    <SkeletonLine className="mb-4 h-6 w-56" />
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
      locale,
      token,
    }),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!listResult.ok && listResult.requiresSignIn) {
    await redirectToLogin(locale, followsListHref(token), tenantId);
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
    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
          <Message message="host.settings.follows_error" />
        </Suspense>
      }
    >
      <Suspense fallback={<FollowListSkeleton />}>
        <FollowListData searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </div>
);

export default FollowsSettingsPage;
