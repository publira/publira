import type { Locale } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SortableItem, SortableItemHandle } from "#components/sortable-list";
import { campaignBannerStatus } from "#lib/campaign-banner-schedule";
import { getMessages } from "#lib/get-messages";

import type { CampaignBannerListItem } from "../campaign-banner-types";
import { CampaignBannerDeleteButton } from "./campaign-banner-delete-button";
import { CampaignBannerSortableList } from "./campaign-banner-sortable-list";
import { CampaignBannerStatusChip } from "./campaign-banner-status";

interface CampaignBannerListProps {
  banners: CampaignBannerListItem[];
  /**
   * Whether the operator may write the banners. Without it the list is the
   * banners in their order and nothing that would change them.
   */
  canEdit: boolean;
  locale: Locale;
  now: Temporal.Instant;
  tenantId: string;
  timeZone: string;
}

/** The smallest wide cut of the image, which is all a row has room for. */
const thumbnailOf = (banner: CampaignBannerListItem) =>
  banner.imageVariants
    .filter((variant) => variant.variantType === "landscape")
    .toSorted((a, b) => a.width - b.width)
    .at(0);

const EmptyThumbnail = () => (
  <div
    aria-hidden="true"
    className="aspect-video w-24 shrink-0 rounded-control border border-dashed border-border bg-muted/40"
  />
);

/** An `alt` cannot be a node, so the thumbnail resolves the catalog itself. */
const CampaignBannerThumbnailImage = async ({
  linkUrl,
  url,
}: {
  linkUrl: string;
  url: string;
}) => {
  const t = await getMessages();

  return (
    <Image
      alt={t("admin.campaign_banners.image_alt", { link: linkUrl })}
      className="aspect-video w-24 shrink-0 rounded-control border object-cover"
      height={54}
      src={url}
      width={96}
    />
  );
};

const CampaignBannerThumbnail = ({
  banner,
}: {
  banner: CampaignBannerListItem;
}) => {
  const thumbnail = thumbnailOf(banner);

  return thumbnail ? (
    <Suspense
      fallback={
        <Skeleton className="aspect-video w-24 shrink-0 rounded-control" />
      }
    >
      <CampaignBannerThumbnailImage
        linkUrl={banner.linkUrl}
        url={thumbnail.url}
      />
    </Suspense>
  ) : (
    <EmptyThumbnail />
  );
};

/**
 * What a reader sees of the banner, read off the row: the image, where it
 * links, when it shows in the tenant's zone, and whether it is showing now.
 */
const CampaignBannerSummary = ({
  banner,
  locale,
  now,
  timeZone,
}: {
  banner: CampaignBannerListItem;
  locale: Locale;
  now: Temporal.Instant;
  timeZone: string;
}) => (
  <div className="flex min-w-0 flex-1 items-start gap-3">
    <CampaignBannerThumbnail banner={banner} />
    <div className="grid min-w-0 gap-1">
      <p className="truncate text-sm font-medium">{banner.linkUrl}</p>
      <p className="text-sm text-muted-foreground tabular-nums">
        <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
          <Message
            message="admin.campaign_banners.window"
            values={{
              ends_at: formatDateTime(banner.endsAt, { locale, timeZone }),
              starts_at: formatDateTime(banner.startsAt, { locale, timeZone }),
              time_zone: timeZone,
            }}
          />
        </Suspense>
      </p>
      <div>
        <CampaignBannerStatusChip status={campaignBannerStatus(banner, now)} />
      </div>
    </div>
  </div>
);

const CampaignBannerRow = ({
  banner,
  locale,
  now,
  tenantId,
  timeZone,
}: {
  banner: CampaignBannerListItem;
  locale: Locale;
  now: Temporal.Instant;
  tenantId: string;
  timeZone: string;
}) => (
  <SortableItem
    className="grid gap-3 border border-border bg-background px-4 py-3 sm:flex sm:items-start sm:justify-between sm:gap-4"
    id={banner.id}
    label={banner.linkUrl}
  >
    <SortableItemHandle>
      <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
        <Message
          message="admin.campaign_banners.reorder_action"
          values={{ link: banner.linkUrl }}
        />
      </Suspense>
    </SortableItemHandle>
    <CampaignBannerSummary
      banner={banner}
      locale={locale}
      now={now}
      timeZone={timeZone}
    />
    <div className="flex flex-wrap items-start gap-2">
      <LinkButton
        render={<Link href={`/campaign-banners/${banner.publicId}`} />}
        size="sm"
        variant="outline"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="admin.campaign_banners.edit_action" />
        </Suspense>
      </LinkButton>
      <CampaignBannerDeleteButton
        id={banner.id}
        linkUrl={banner.linkUrl}
        tenantId={tenantId}
      />
    </div>
  </SortableItem>
);

/** A banner as a tenant auditor sees it: described, and opened to be viewed. */
const ReadOnlyCampaignBannerRow = ({
  banner,
  locale,
  now,
  timeZone,
}: {
  banner: CampaignBannerListItem;
  locale: Locale;
  now: Temporal.Instant;
  timeZone: string;
}) => (
  <li className="flex items-start justify-between gap-4 border border-border bg-background px-4 py-3">
    <CampaignBannerSummary
      banner={banner}
      locale={locale}
      now={now}
      timeZone={timeZone}
    />
    <LinkButton
      render={<Link href={`/campaign-banners/${banner.publicId}`} />}
      size="sm"
      variant="outline"
    >
      <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
        <Message message="admin.common.view_action" />
      </Suspense>
    </LinkButton>
  </li>
);

/**
 * The tenant's banners in their own order — the order the site shows the ones
 * on air in — with the controls that write it for an operator who may.
 */
export const CampaignBannerList = ({
  banners,
  canEdit,
  locale,
  now,
  tenantId,
  timeZone,
}: CampaignBannerListProps) =>
  canEdit ? (
    <CampaignBannerSortableList
      rows={banners.map((banner) => ({
        content: (
          <CampaignBannerRow
            banner={banner}
            locale={locale}
            now={now}
            tenantId={tenantId}
            timeZone={timeZone}
          />
        ),
        id: banner.id,
      }))}
      tenantId={tenantId}
    />
  ) : (
    <ul className="grid gap-3">
      {banners.map((banner) => (
        <ReadOnlyCampaignBannerRow
          banner={banner}
          key={banner.id}
          locale={locale}
          now={now}
          timeZone={timeZone}
        />
      ))}
    </ul>
  );
