"use client";

import { useAdminLocale } from "#components/admin-locale-context";
import { useClientMessages } from "#components/client-message";
import { formatTenantAmount } from "#lib/price";

/**
 * An episode's status and price, as one line of its row in the list. The price
 * is a dash while the tenant's currency could not be read.
 */
export const EpisodeStatusPrice = ({
  currency,
  price,
  status,
}: {
  currency: string | null;
  price: number;
  status: string;
}) => {
  const locale = useAdminLocale();
  const t = useClientMessages();

  // Each branch names its key literally. `draft` is the only other value the
  // database accepts.
  let statusLabel = t("admin.series.episodes.status_draft");

  if (status === "scheduled") {
    statusLabel = t("admin.series.episodes.status_scheduled");
  } else if (status === "published") {
    statusLabel = t("admin.series.episodes.status_published");
  }

  return t("admin.series.episodes.status_price", {
    price: formatTenantAmount(price, { currency, locale }),
    status: statusLabel,
  });
};
