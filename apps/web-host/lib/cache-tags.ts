import { cacheTag } from "next/cache";

const normalized = (tenantId: string) => tenantId.trim();

export const tenantSeriesListTag = (tenantId: string) =>
  `tenant:${normalized(tenantId)}:series:list`;

export const tenantSeriesDetailTag = (tenantId: string) =>
  `tenant:${normalized(tenantId)}:series:detail`;

export const tenantSeriesTag = (tenantId: string, seriesPublicId: string) =>
  `tenant:${normalized(tenantId)}:series:${seriesPublicId.trim()}`;

export const tenantAuthorsTag = (tenantId: string) =>
  `tenant:${normalized(tenantId)}:authors`;

export const tenantLabelsTag = (tenantId: string) =>
  `tenant:${normalized(tenantId)}:labels`;

export const tenantSiteTag = (tenantId: string) =>
  `tenant:${normalized(tenantId)}:site`;

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
