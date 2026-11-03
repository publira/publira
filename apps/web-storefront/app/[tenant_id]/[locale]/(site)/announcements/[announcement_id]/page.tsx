import type { Locale } from "@publira/i18n";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { PageLoadError } from "#components/page-load-error";
import { getAnnouncementForReader } from "#lib/announcements";
import { withPublicSessionReauth } from "#lib/auth-session";
import { PUBLIC_SESSION_COOKIE_NAME } from "#lib/auth-shared";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { toSafeOperatorLinkUrl } from "#lib/operator-link";
import { fallbackLanguage } from "#lib/served-locale";
import { getTenantDisplayTimeZone } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";
import { tenantPublishedLocaleAlternates } from "#lib/tenant-locale-path";

import { AnnouncementFallbackNotice } from "../_components/announcement-fallback-notice";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "announcement_id");

const announcementDetailParamsSchema = z.object({
  announcement_id: routeParamString(),
});

/**
 * The announcement as the visitor who opened it may see it. A public one is the
 * shared read; a targeted one is read again with the session, only when its
 * cookie is there, so it opens for the readers it was sent to and is
 * `notFound()` for everyone else — raised by the caller, outside both cached
 * reads. A session the API rejects sends the reader to sign in again and back
 * to this page.
 */
const readAnnouncement = async (
  tenantId: string,
  announcementId: string,
  locale: Locale
) => {
  const cookieStore = await cookies();
  const signedIn = Boolean(cookieStore.get(PUBLIC_SESSION_COOKIE_NAME)?.value);

  return withPublicSessionReauth(
    locale,
    `/announcements/${announcementId}`,
    () => getAnnouncementForReader(tenantId, announcementId, locale, signedIn),
    tenantId
  );
};

export const generateMetadata = async (
  props: PageProps<"/[tenant_id]/[locale]/announcements/[announcement_id]">
): Promise<Metadata> => {
  const [rawParams, tenantId, locale] = await Promise.all([
    props.params,
    getTenantId(),
    getLocale(),
  ]);

  const parsedParams = parseRouteParams(
    announcementDetailParamsSchema,
    rawParams
  );

  if (!parsedParams) {
    notFound();
  }

  const { announcement_id } = parsedParams;

  const [result, t] = await Promise.all([
    readAnnouncement(tenantId, announcement_id, locale),
    getMessagesFor(locale),
  ]);

  // An unavailable announcement reads as "not found" for the `<title>` alone;
  // the page body below says what actually happened.
  const announcement = result.ok ? result.value : null;

  if (!announcement) {
    return { title: t("storefront.errors.not_found_title") };
  }

  // Alternates wait on the announcement: only a language it was written in is
  // a language of this URL, and the canonical one is the language served.
  const alternates = await tenantPublishedLocaleAlternates(
    tenantId,
    `/announcements/${announcement.id}`,
    announcement.publishedLocales,
    announcement.locale
  );

  return { alternates, title: announcement.title };
};

const AnnouncementDetailSkeleton = () => (
  <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <section className="border border-border bg-card p-6">
      <SkeletonLine className="mb-4 h-4 w-32" />
      <SkeletonLine className="mb-3 h-7 w-2/3" />
      <SkeletonLine className="mb-6 h-4 w-40" />
      <Skeleton className="h-24 w-full" />
    </section>
  </div>
);

const AnnouncementDetailBody = async (
  props: PageProps<"/[tenant_id]/[locale]/announcements/[announcement_id]">
) => {
  const [rawParams, tenantId, locale] = await Promise.all([
    props.params,
    getTenantId(),
    getLocale(),
  ]);

  const parsedParams = parseRouteParams(
    announcementDetailParamsSchema,
    rawParams
  );

  if (!parsedParams) {
    notFound();
  }

  const [result, timeZone] = await Promise.all([
    readAnnouncement(tenantId, parsedParams.announcement_id, locale),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!result.ok) {
    return <PageLoadError description={result.message} />;
  }

  const announcement = result.value;

  if (!announcement) {
    notFound();
  }

  const linkUrl = toSafeOperatorLinkUrl(announcement.linkUrl);

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="grid gap-4 border border-border bg-card p-6">
        <LocaleLink
          className="text-sm text-primary underline-offset-4 hover:underline"
          href="/announcements"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="storefront.announcements.back_to_list" />
          </Suspense>
        </LocaleLink>
        <AnnouncementFallbackNotice
          language={fallbackLanguage(locale, announcement.locale)}
        />
        <article className="grid gap-4">
          <header className="grid gap-1">
            <h1 className="text-xl font-semibold" lang={announcement.locale}>
              {announcement.title}
            </h1>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(announcement.createdAt, {
                fallback: "-",
                locale,
                timeZone,
              })}
            </p>
          </header>
          <p
            className="text-sm leading-6 whitespace-pre-line"
            lang={announcement.locale}
          >
            {announcement.body}
          </p>
          {linkUrl ? (
            <div>
              <LocaleLink
                className="inline-flex rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                href={linkUrl}
              >
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="storefront.announcements.open_link" />
                </Suspense>
              </LocaleLink>
            </div>
          ) : null}
        </article>
      </section>
    </div>
  );
};

const AnnouncementDetailPage = (
  props: PageProps<"/[tenant_id]/[locale]/announcements/[announcement_id]">
) => (
  <Suspense fallback={<AnnouncementDetailSkeleton />}>
    <AnnouncementDetailBody {...props} />
  </Suspense>
);

export default AnnouncementDetailPage;
