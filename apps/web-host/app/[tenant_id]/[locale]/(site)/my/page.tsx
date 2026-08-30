import { getMessage } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import type { MeInfo, NotificationSettings } from "#lib/auth";
import { getMe, getNotificationSettings } from "#lib/auth";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { getLocale, loadHostMessages } from "#lib/locale";
import type { HostMessageKey } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

const MY_RETURN_TO = "/my";

const EmptyState = ({
  description,
  title,
}: {
  description: string;
  title: string;
}) => (
  <div className="rounded-xl border border-dashed border-border/70 bg-muted/30 p-5">
    <p className="text-sm font-medium text-foreground">{title}</p>
    <p className="mt-1 text-sm text-muted-foreground">{description}</p>
  </div>
);

const ProfileSection = async ({ me }: { me: MeInfo }) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
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
  <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
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

const SubscriptionSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [notificationSettings, messages] = await Promise.all([
    withPublicSessionReauth(
      locale,
      MY_RETURN_TO,
      () => getNotificationSettings(tenantId),
      tenantId
    ),
    loadHostMessages(locale),
  ]);

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
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
        <EmptyState
          description={getMessage(
            messages,
            "host.my.subscription_empty_description"
          )}
          title={getMessage(messages, "host.my.subscription_empty_title")}
        />
      </div>
    </section>
  );
};

const SubscriptionSectionFallback = () => (
  <SectionSkeleton bodyClassName="h-20 w-full animate-pulse rounded-md bg-muted" />
);

const MyContent = async () => {
  const [locale, tenantId] = await Promise.all([getLocale(), getTenantId()]);
  await requirePublicSession(locale, MY_RETURN_TO, tenantId);
  const [me, messages] = await Promise.all([
    withPublicSessionReauth(
      locale,
      MY_RETURN_TO,
      () => getMe(tenantId),
      tenantId
    ),
    loadHostMessages(locale),
  ]);

  return (
    <>
      <Suspense fallback={<ProfileSectionFallback />}>
        {me ? (
          <ProfileSection me={me} />
        ) : (
          <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold">
              {getMessage(messages, "host.my.profile_heading")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {getMessage(messages, "host.my.session_expired")}
            </p>
            <div className="mt-4">
              <LocaleLink
                className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                href="/login?returnTo=%2Fmy"
              >
                {getMessage(messages, "host.my.to_login")}
              </LocaleLink>
            </div>
          </section>
        )}
      </Suspense>

      {me ? (
        <Suspense fallback={<SubscriptionSectionFallback />}>
          <SubscriptionSection />
        </Suspense>
      ) : null}

      <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">
          {getMessage(messages, "host.my.history_heading")}
        </h2>
        <EmptyState
          description={getMessage(
            messages,
            "host.my.history_empty_description"
          )}
          title={getMessage(messages, "host.my.history_empty_title")}
        />
      </section>
    </>
  );
};

const MyContentFallback = () => (
  <>
    <ProfileSectionFallback />
    <SubscriptionSectionFallback />
    <SectionSkeleton bodyClassName="h-20 w-full animate-pulse rounded-md bg-muted" />
  </>
);

const MyPage = () => (
  <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
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
      <MyContent />
    </Suspense>
  </div>
);

export default MyPage;
