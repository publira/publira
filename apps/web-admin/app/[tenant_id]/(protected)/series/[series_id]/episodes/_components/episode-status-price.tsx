"use client";

import { formatYen } from "@publira/utils";

import { useAdminLocale } from "#components/admin-locale-context";
import { useClientMessages } from "#components/client-message";

/** An episode's status and price, as one line of its row in the list. */
export const EpisodeStatusPrice = ({
  price,
  status,
}: {
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
    price: formatYen(price, { locale }),
    status: statusLabel,
  });
};
