import type { Locale } from "@publira/i18n";
import { parseInstant, toInstantIsoString } from "@publira/utils";

import { getMessagesFor } from "./messages";

/**
 * The longest link the API stores, which is what a browser keeps in its
 * address bar.
 */
export const CAMPAIGN_BANNER_LINK_MAX_LENGTH = 2048;

/**
 * The longest alternative text the API stores. The API counts code points and
 * this bound counts UTF-16 units, as `maxLength` does, so a text the form lets
 * through is never one the API refuses.
 */
export const CAMPAIGN_BANNER_ALT_TEXT_MAX_LENGTH = 255;

/**
 * Whether a link is one the API stores: a path on the tenant's own site, or an
 * absolute http(s) URL. A path that starts with `//` or `/\` is neither,
 * because a browser reads either as another site.
 *
 * The API holds the link to the same rule; it is checked here as well so the
 * operator is answered next to the form rather than by a refused RPC.
 */
export const isCampaignBannerLink = (value: string): boolean => {
  if (value.startsWith("/")) {
    return !(value.startsWith("//") || value.startsWith("/\\"));
  }

  if (!URL.canParse(value)) {
    return false;
  }

  const url = new URL(value);

  return (
    (url.protocol === "https:" || url.protocol === "http:") &&
    url.host.length > 0
  );
};

export type CampaignBannerWindowResult =
  | { ok: true; startsAt: string; endsAt: string }
  | { ok: false; message: string };

/**
 * The window a banner form posted, as the two instants the API takes.
 *
 * Each field carries the instant the form resolved in the zone it was rendered
 * in; a leftover wall clock (no JS) is read in `timeZone`. The end has to come
 * after the start. A create also holds the end to the future, as the API does,
 * since a banner nobody can see is more likely a mistyped date than a
 * campaign. An update leaves that to the API, which lets a window the banner
 * already has stay over, so an expired banner can still be unpublished or
 * relinked without being rescheduled. A start already passed is allowed: that
 * is how a banner goes up at once.
 */
export const toCampaignBannerWindow = async (
  input: { startsAt: string; endsAt: string },
  options: { requireFutureEnd: boolean; timeZone: string },
  locale: Locale,
  now: Temporal.Instant = Temporal.Now.instant()
): Promise<CampaignBannerWindowResult> => {
  const t = await getMessagesFor(locale);
  const startsAt = toInstantIsoString(input.startsAt, options.timeZone);
  const start = parseInstant(startsAt);

  if (!start) {
    return {
      message: t("admin.campaign_banners.validation.starts_at_invalid"),
      ok: false,
    };
  }

  const endsAt = toInstantIsoString(input.endsAt, options.timeZone);
  const end = parseInstant(endsAt);

  if (!end) {
    return {
      message: t("admin.campaign_banners.validation.ends_at_invalid"),
      ok: false,
    };
  }

  if (
    Temporal.Instant.compare(end, start) <= 0 ||
    (options.requireFutureEnd && Temporal.Instant.compare(end, now) <= 0)
  ) {
    return {
      message: t("admin.campaign_banners.validation.period_invalid"),
      ok: false,
    };
  }

  return { endsAt, ok: true, startsAt };
};

/** Where a banner stands for a reader of the site at the present moment. */
export type CampaignBannerStatus =
  | "ended"
  | "scheduled"
  | "showing"
  | "unpublished";

/**
 * The banner's standing at `now`. An unpublished banner never shows, whatever
 * its window. The window is half-open, so the banner has ended at the very
 * instant it ends, which is when the next one may begin.
 */
export const campaignBannerStatus = (
  banner: { published: boolean; startsAt: string; endsAt: string },
  now: Temporal.Instant
): CampaignBannerStatus => {
  if (!banner.published) {
    return "unpublished";
  }

  const start = parseInstant(banner.startsAt);
  const end = parseInstant(banner.endsAt);

  if (end && Temporal.Instant.compare(end, now) <= 0) {
    return "ended";
  }

  if (start && Temporal.Instant.compare(start, now) > 0) {
    return "scheduled";
  }

  return "showing";
};
