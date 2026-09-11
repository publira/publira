import { getMessage } from "@publira/i18n";
import {
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import type { MeInfo, NotificationSettings } from "#lib/auth";
import { getMe, getNotificationSettings } from "#lib/auth";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { getLocale, loadHostMessages } from "#lib/locale";
import type { HostMessageKey } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import { ReadingHistorySection } from "./_components/reading-history";
import { myPageHref, parseMySearchParams } from "./_lib/search-params";

type MyPageProps = PageProps<"/[tenant_id]/[locale]/my">;

const ProfileSection = async ({ me }: { me: MeInfo }) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <section className="border border-border bg-card p-6">
      <h2 className="mb-4 text-lg font-semibold">
        {getMessage(messages, "host.my.profile_heading")}
      </h2>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-border/60 p-3">
          <dt className="text-muted-foreground">
            {getMessage(messages, "host.my.profile_name")}
          </dt>
          <dd className="mt-1 font-medium">
            {me?.name ?? getMessage(messages, "host.common.unset")}
          </dd>
        </div>
        <div className="rounded-lg border border-border/60 p-3">
          <dt className="text-muted-foreground">
            {getMessage(messages, "host.my.profile_user_id")}
          </dt>
          <dd className="mt-1 font-medium">{me?.publicId ?? "-"}</dd>
        </div>
      </dl>
      <div className="mt-4 flex justify-end">
        <LocaleLink
          className="inline-flex rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
          href="/settings"
        >
          {getMessage(messages, "host.my.to_settings_page")}
        </LocaleLink>
      </div>
    </section>
  );
};

const SectionSkeleton = ({ bodyClassName }: { bodyClassName: string }) => (
  <section className="border border-border bg-card p-6">
    <SkeletonLine className="mb-4 h-6 w-32" />
    <div className={bodyClassName} />
  </section>
);

const ProfileSectionFallback = () => (
  <SectionSkeleton bodyClassName="h-24 w-full animate-pulse rounded-md bg-muted" />
);

/** The subscription state picks a key, so the copy still comes from the catalog. */
const notificationStatusKey = (
  settings: NotificationSettings | null
): HostMessageKey => {
  if (settings === null) {
    return "host.my.email_notifications_unknown";
  }
  return settings.emailNotificationsEnabled === false
    ? "host.my.email_notifications_off"
    : "host.my.email_notifications_on";
};

const SubscriptionSection = async ({ returnTo }: { returnTo: string }) => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [notificationSettings, messages] = await Promise.all([
    withPublicSessionReauth(
      locale,
      returnTo,
      () => getNotificationSettings(tenantId),
      tenantId
    ),
    loadHostMessages(locale),
  ]);

  return (
    <section className="border border-border bg-card p-6">
      <h2 className="mb-4 text-lg font-semibold">
        {getMessage(messages, "host.my.subscription_heading")}
      </h2>
      <div className="rounded-lg border border-border/60 p-3 text-sm">
        <p className="text-muted-foreground">
          {getMessage(messages, "host.my.email_notifications_label")}
        </p>
        <p className="mt-1 font-medium">
          {getMessage(messages, notificationStatusKey(notificationSettings))}
        </p>
      </div>
      <div className="mt-4">
        <EmptyState>
          <EmptyStateHeading>
            <EmptyStateTitle>
              {getMessage(messages, "host.my.subscription_empty_title")}
            </EmptyStateTitle>
            <EmptyStateDescription>
              {getMessage(messages, "host.my.subscription_empty_description")}
            </EmptyStateDescription>
          </EmptyStateHeading>
        </EmptyState>
      </div>
    </section>
  );
};

const SubscriptionSectionFallback = () => (
  <SectionSkeleton bodyClassName="h-20 w-full animate-pulse rounded-md bg-muted" />
);

const ReadingHistorySectionFallback = () => (
  <SectionSkeleton bodyClassName="h-32 w-full animate-pulse rounded-md bg-muted" />
);

const MyContent = async ({
  searchParams,
}: Pick<MyPageProps, "searchParams">) => {
  const [locale, tenantId, resolvedSearchParams] = await Promise.all([
    getLocale(),
    getTenantId(),
    searchParams,
  ]);
  const { token } = parseMySearchParams(resolvedSearchParams);
  // Every way out of this page to the sign-in screen names the history page
  // the reader was on, so signing in again puts them back on it rather than on
  // page 1.
  const returnTo = myPageHref(token);
  await requirePublicSession(locale, returnTo, tenantId);
  const [me, messages] = await Promise.all([
    withPublicSessionReauth(locale, returnTo, () => getMe(tenantId), tenantId),
    loadHostMessages(locale),
  ]);

  return (
    <>
      <Suspense fallback={<ProfileSectionFallback />}>
        {me ? (
          <ProfileSection me={me} />
        ) : (
          <section className="border border-border bg-card p-6">
            <h2 className="mb-3 text-lg font-semibold">
              {getMessage(messages, "host.my.profile_heading")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {getMessage(messages, "host.my.session_expired")}
            </p>
            <div className="mt-4">
              <LocaleLink
                className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                href={`/login?returnTo=${encodeURIComponent(returnTo)}`}
              >
                {getMessage(messages, "host.my.to_login")}
              </LocaleLink>
            </div>
          </section>
        )}
      </Suspense>

      {me ? (
        <Suspense fallback={<SubscriptionSectionFallback />}>
          <SubscriptionSection returnTo={returnTo} />
        </Suspense>
      ) : null}

      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="host.my.history_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<ReadingHistorySectionFallback />}>
          <ReadingHistorySection token={token} />
        </Suspense>
      </SectionErrorBoundary>
    </>
  );
};

const MyContentFallback = () => (
  <>
    <ProfileSectionFallback />
    <SubscriptionSectionFallback />
    <ReadingHistorySectionFallback />
  </>
);

const MyPage = ({ searchParams }: MyPageProps) => (
  <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <section className="border border-border bg-card p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            <Suspense fallback={<SkeletonLine className="h-6 w-32" />}>
              <Message message="host.my.title" />
            </Suspense>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <Message message="host.my.description" />
            </Suspense>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LocaleLink
            className="inline-flex rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
            href="/my/library"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="host.my.to_library" />
            </Suspense>
          </LocaleLink>
          <LocaleLink
            className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            href="/settings"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="host.my.to_settings" />
            </Suspense>
          </LocaleLink>
        </div>
      </div>
    </section>

    <Suspense fallback={<MyContentFallback />}>
      <MyContent searchParams={searchParams} />
    </Suspense>
  </div>
);

export default MyPage;
