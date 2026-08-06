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

export const tenantSiteTag = (tenantId: string) =>
  `tenant:${normalized(tenantId)}:site`;

export const tenantPagesTag = (tenantId: string) =>
  `tenant:${normalized(tenantId)}:pages`;

export const tenantPageTag = (tenantId: string, pageId: string) =>
  `tenant:${normalized(tenantId)}:pages:${pageId.trim()}`;

export const applyCacheTag = (tag: string) => {
  try {
    cacheTag(tag);
  } catch {
    // Some unit tests run without Next cacheComponents runtime support.
  }
};
