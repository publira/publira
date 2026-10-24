import type { AdminMessageAccessor } from "./messages";
import type { PurchaseItem } from "./purchase";

/**
 * What the list and the drawer call what a purchase bought: the episode's or
 * the volume's title, its public ID when the title is empty, or how many
 * episodes the rest of the series came to.
 */
export const purchasedItemLabel = (
  purchase: PurchaseItem,
  t: AdminMessageAccessor
): string => {
  const { item } = purchase;
  if (item.kind === "series_bundle") {
    return t("admin.purchases.series_bundle", { count: item.episodeCount });
  }
  return item.title || item.publicId;
};

/**
 * The console page of what a purchase bought. The rest of a series has no
 * page of its own, so it opens the series.
 */
export const purchasedItemHref = (purchase: PurchaseItem): string => {
  const seriesHref = `/series/${purchase.seriesPublicId}`;
  const { item } = purchase;
  switch (item.kind) {
    case "episode": {
      return `${seriesHref}/episodes/${item.publicId}`;
    }
    case "volume": {
      return `${seriesHref}/volumes/${item.publicId}`;
    }
    default: {
      return seriesHref;
    }
  }
};
