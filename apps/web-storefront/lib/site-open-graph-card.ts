import { getLocale } from "./locale";
import { openGraphCardImage } from "./open-graph";
import type { SiteOpenGraphCard } from "./open-graph";
import { tenantOpenGraphCardPath } from "./open-graph-card-subject";
import { getTenantSiteCopy, getTenantSiteLabel } from "./tenant";
import { getTenantId } from "./tenant-id";

/** The site's own card for the tenant and locale being rendered. */
export const getSiteOpenGraphCard = async (): Promise<SiteOpenGraphCard> => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const [{ siteDescription }, siteName, cardPath] = await Promise.all([
    getTenantSiteCopy(tenantId, locale),
    getTenantSiteLabel(tenantId, locale),
    tenantOpenGraphCardPath(tenantId, locale, { kind: "site" }),
  ]);

  return {
    description: siteDescription,
    image: cardPath ? openGraphCardImage(cardPath, siteName) : undefined,
    siteName,
  };
};
