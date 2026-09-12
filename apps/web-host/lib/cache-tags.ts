import { cacheTag } from "next/cache";

const normalized = (tenantId: string) => tenantId.trim();

export const tenantSeriesListTag = (tenantId: string) =>
  `tenant:${normalized(tenantId)}:series:list`;

export const tenantSeriesDetailTag = (tenantId: string) =>
  `tenant:${normalized(tenantId)}:series:detail`;

export const tenantSeriesTag = (tenantId: string, seriesPublicId: string) =>
  `tenant:${normalized(tenantId)}:series:${seriesPublicId.trim()}`;

export const tenantCreatorsTag = (tenantId: string) =>
  `tenant:${normalized(tenantId)}:creators`;

export const tenantLabelsTag = (tenantId: string) =>
  `tenant:${normalized(tenantId)}:labels`;

export const tenantSiteTag = (tenantId: string) =>
  `tenant:${normalized(tenantId)}:site`;

/**
 * What a cached read carries when its answer depends on what day it is where
 * the tenant publishes — the weekday the storefront's schedule module opens
 * on, and nothing else so far.
 *
 * Such an answer goes stale at the tenant's own midnight rather than on an
 * edit, so the `roll-tenant-day` batch drops this tag when that tenant's
 * calendar day turns (`server/cmd/batch/README.md`). It is a tag of its own
 * for exactly that reason: a daily drop aimed at the catalog's tags would take
 * every series list and every series page with it, for a value that is one
 * number on one module.
 */
export const tenantTodayTag = (tenantId: string) =>
  `tenant:${normalized(tenantId)}:today`;

/**
 * The dynamic `/theme.css` Route Handler consumes this tag through
 * `getTenantTheme()`. Keep it distinct from site chrome, so a theme save has
 * an explicit, auditable invalidation target.
 */
export const tenantThemeTag = (tenantId: string) =>
  `tenant:${normalized(tenantId)}:theme`;

export const tenantPagesTag = (tenantId: string) =>
  `tenant:${normalized(tenantId)}:pages`;

export const tenantPageTag = (tenantId: string, pageId: string) =>
  `tenant:${normalized(tenantId)}:pages:${pageId.trim()}`;

export const tenantNotificationsTag = (tenantId: string) =>
  `tenant:${normalized(tenantId)}:notifications`;

export const tenantFollowsTag = (tenantId: string) =>
  `tenant:${normalized(tenantId)}:follows`;

export const tenantAnnouncementsTag = (tenantId: string) =>
  `tenant:${normalized(tenantId)}:announcements`;

/**
 * The cached public comment list of one episode. Posting and withdrawing both
 * change what it answers, so the Actions behind those controls drop it.
 *
 * The viewer's own comments are read uncached and carry no tag: nothing holds
 * them, so there is nothing to invalidate.
 */
export const tenantEpisodeCommentsTag = (
  tenantId: string,
  episodePublicId: string
) =>
  `tenant:${normalized(tenantId)}:episode:${episodePublicId.trim()}:comments`;

export const applyCacheTag = (tag: string) => {
  try {
    cacheTag(tag);
  } catch {
    // Some unit tests run without Next cacheComponents runtime support.
  }
};
