import { EyeCatchFrame } from "#components/eye-catch-frame";
import { LocaleLink } from "#components/locale-link";
import type { CampaignBannerItem } from "#lib/campaign-banners";
import { listCampaignBanners } from "#lib/campaign-banners";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";

import * as CampaignBannerCarousel from "./campaign-banner-carousel";

/**
 * One banner, drawn in the ratio the console labels as the band's: the
 * operator cropped it for this shape, so it is shown whole rather than cut to
 * fit a band of some other height.
 *
 * The image is the link's only content, so its alternative text is the link's
 * name: the words drawn into it as the operator wrote them, or `fallbackAlt`
 * when they wrote none.
 *
 * The first one is what a reader sees before anything else on the page, so it
 * is fetched first; the rest wait until the strip brings them near.
 */
const CampaignBannerLink = ({
  banner,
  fallbackAlt,
  first,
}: {
  banner: CampaignBannerItem;
  fallbackAlt: string;
  first: boolean;
}) => (
  <LocaleLink className="block" href={banner.linkUrl}>
    <EyeCatchFrame
      alt={banner.altText || fallbackAlt}
      className="aspect-video w-full rounded-surface"
      fetchPriority={first ? "high" : undefined}
      loading={first ? "eager" : "lazy"}
      preferredType="landscape"
      sizes="(max-width: 767px) 100vw, 768px"
      variants={banner.imageVariants}
    />
  </LocaleLink>
);

/**
 * The campaigns the tenant has on right now, above everything else on the top
 * page.
 *
 * Nothing at all is drawn when none is on, or when the read failed — no
 * heading, no empty band, no space kept for one — so a tenant that schedules
 * no banner has the top page it always had. One banner is one band with
 * nothing to operate; two or more are a strip the reader moves through.
 *
 * On a wide screen a banner takes two thirds of the column rather than all of
 * it, because the band keeps the ratio its image was cropped to and a banner
 * the width of the column would stand taller than the work the page opens
 * with. In a strip that leaves room for the neighbours to show at both edges,
 * which is what says there is more than one; the strip runs on from the last
 * banner into the first, so a neighbour shows on both sides of every one.
 */
export const CampaignBannersSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const [banners, t] = await Promise.all([
    listCampaignBanners(tenantId),
    getMessagesFor(locale),
  ]);

  const [firstBanner, ...rest] = banners;

  if (!firstBanner) {
    return null;
  }

  const ariaLabel = t("storefront.top.campaign_banners_aria");
  const fallbackAlt = t("storefront.top.campaign_banner_alt");

  if (rest.length === 0) {
    return (
      <section aria-label={ariaLabel}>
        <div className="mx-auto md:w-2/3">
          <CampaignBannerLink
            banner={firstBanner}
            fallbackAlt={fallbackAlt}
            first
          />
        </div>
      </section>
    );
  }

  const lastBanner = rest.at(-1) ?? firstBanner;

  return (
    <CampaignBannerCarousel.Root
      aria-label={ariaLabel}
      count={banners.length}
      first={
        <CampaignBannerLink
          banner={firstBanner}
          fallbackAlt={fallbackAlt}
          first={false}
        />
      }
      last={
        <CampaignBannerLink
          banner={lastBanner}
          fallbackAlt={fallbackAlt}
          first={false}
        />
      }
    >
      {banners.map((banner, index) => (
        <CampaignBannerCarousel.Slide key={banner.publicId}>
          <CampaignBannerLink
            banner={banner}
            fallbackAlt={fallbackAlt}
            first={index === 0}
          />
        </CampaignBannerCarousel.Slide>
      ))}
    </CampaignBannerCarousel.Root>
  );
};
