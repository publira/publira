import { CloseIcon } from "@publira/icons";
import {
  SiteLayoutBanner,
  SiteLayoutBannerActions,
  SiteLayoutBannerContent,
  SiteLayoutBannerDescription,
  SiteLayoutBannerLink,
  SiteLayoutBannerTitle,
} from "@publira/layouts";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getPinnedAnnouncement } from "#lib/announcements";
import { dismissAnnouncementBannerAction } from "#lib/dismiss-announcement-action";
import { readDismissedAnnouncementId } from "#lib/dismissed-announcement-cookie";
import { getMessages } from "#lib/get-messages";
import { getLocale, tenantDefaultLocale } from "#lib/locale";
import { withLocalePrefix } from "#lib/locale-path";
import { toSafeOperatorLinkUrl } from "#lib/operator-link";
import { getTenantId } from "#lib/tenant-id";

/** The close button, which carries its name as an attribute. */
const DismissBannerButton = async () => {
  const t = await getMessages();

  return (
    <button
      aria-label={t("storefront.announcements.banner_dismiss")}
      className="inline-flex size-8 items-center justify-center rounded-control transition-colors duration-state ease-state hover:bg-info-foreground/10"
      type="submit"
    >
      <CloseIcon aria-hidden="true" className="size-4" />
    </button>
  );
};

/**
 * The one announcement an operator asked every reader to see, drawn above the
 * header on every page of the site.
 *
 * It renders nothing at all when the tenant has nothing pinned, when the window
 * has closed, or when this browser has already closed the band — an addition to
 * the page has no empty state. The read behind it names no reader, so it is the
 * same band for a visitor who never signed in.
 */
export const PinnedAnnouncementBanner = async () => {
  const [tenantId, locale, defaultLocale, dismissedId] = await Promise.all([
    getTenantId(),
    getLocale(),
    tenantDefaultLocale(),
    readDismissedAnnouncementId(),
  ]);
  const announcement = await getPinnedAnnouncement(tenantId, locale);

  if (!announcement || announcement.id === dismissedId) {
    return null;
  }

  // An operator who wrote no link is pointing at the announcement itself.
  const destination =
    toSafeOperatorLinkUrl(announcement.linkUrl) ??
    `/announcements/${announcement.id}`;

  return (
    <SiteLayoutBanner>
      <SiteLayoutBannerContent>
        <SiteLayoutBannerTitle>
          <span lang={announcement.locale}>{announcement.title}</span>
        </SiteLayoutBannerTitle>
        <SiteLayoutBannerDescription>
          <span lang={announcement.locale}>{announcement.body}</span>
        </SiteLayoutBannerDescription>
        <SiteLayoutBannerLink
          href={withLocalePrefix(locale, defaultLocale, destination)}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="storefront.announcements.banner_link" />
          </Suspense>
        </SiteLayoutBannerLink>
      </SiteLayoutBannerContent>
      <SiteLayoutBannerActions>
        <form action={dismissAnnouncementBannerAction}>
          <input name="announcementId" type="hidden" value={announcement.id} />
          <Suspense fallback={<SkeletonLine className="h-8 w-8" />}>
            <DismissBannerButton />
          </Suspense>
        </form>
      </SiteLayoutBannerActions>
    </SiteLayoutBanner>
  );
};
