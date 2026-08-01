import { cacheTag } from "next/cache";

const normalized = (tenantPublicId: string) => tenantPublicId.trim();

export const tenantSeriesListTag = (tenantPublicId: string) =>
  `tenant:${normalized(tenantPublicId)}:series:list`;

export const tenantSeriesDetailTag = (tenantPublicId: string) =>
  `tenant:${normalized(tenantPublicId)}:series:detail`;

export const tenantSeriesTag = (
  tenantPublicId: string,
  seriesPublicId: string
) => `tenant:${normalized(tenantPublicId)}:series:${seriesPublicId.trim()}`;

export const tenantAuthorsTag = (tenantPublicId: string) =>
  `tenant:${normalized(tenantPublicId)}:authors`;

export const tenantSiteTag = (tenantPublicId: string) =>
  `tenant:${normalized(tenantPublicId)}:site`;

export const applyCacheTag = (tag: string) => {
  try {
    cacheTag(tag);
  } catch {
    // Some unit tests run without Next cacheComponents runtime support.
  }
};
