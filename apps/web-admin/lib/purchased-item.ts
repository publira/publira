import type { AdminMessageAccessor } from "./messages";
import type { PurchaseItem } from "./purchase";

/**
 * What the list and the drawer call what a purchase bought: the episode's or
 * the volume's title, its public ID when the title is empty, how many
 * episodes the rest of the series came to, or how many of the tenant's coins
 * a pack granted, under the tenant's word for them.
 */
export const purchasedItemLabel = (
  purchase: PurchaseItem,
  t: AdminMessageAccessor
): string => {
  const { item } = purchase;

  switch (item.kind) {
    case "series_bundle": {
      return t("admin.purchases.series_bundle", { count: item.episodeCount });
    }

    case "coin_pack": {
      return t("admin.purchases.coin_pack", {
        bonus: item.bonusCoins,
        coin_name: item.coinName,
        count: item.coins + item.bonusCoins,
      });
    }

    default: {
      return item.title || item.publicId;
    }
  }
};

/**
 * The console page of what a purchase bought, or `null` for a pack of coins,
 * which has none. The rest of a series has no page of its own, so it opens
 * the series.
 */
export const purchasedItemHref = (purchase: PurchaseItem): string | null => {
  const seriesHref = `/series/${purchase.seriesPublicId}`;
  const { item } = purchase;

  switch (item.kind) {
    case "episode": {
      return `${seriesHref}/episodes/${item.publicId}`;
    }

    case "volume": {
      return `${seriesHref}/volumes/${item.publicId}`;
    }

    case "coin_pack": {
      return null;
    }

    default: {
      return seriesHref;
    }
  }
};
