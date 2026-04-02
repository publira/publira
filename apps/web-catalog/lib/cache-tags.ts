const normalized = (tenantPublicId: string) => tenantPublicId.trim();

export const tenantCatalogSeriesListTag = (tenantPublicId: string) =>
  `tenant:${normalized(tenantPublicId)}:catalog:series:list`;

export const tenantCatalogSeriesDetailTag = (tenantPublicId: string) =>
  `tenant:${normalized(tenantPublicId)}:catalog:series:detail`;

export const tenantCatalogSeriesTag = (
  tenantPublicId: string,
  seriesPublicId: string
) => `tenant:${normalized(tenantPublicId)}:catalog:series:${seriesPublicId.trim()}`;

export const tenantCatalogAuthorsTag = (tenantPublicId: string) =>
  `tenant:${normalized(tenantPublicId)}:catalog:authors`;

export const tenantPublicSiteTag = (tenantPublicId: string) =>
  `tenant:${normalized(tenantPublicId)}:public:site`;
