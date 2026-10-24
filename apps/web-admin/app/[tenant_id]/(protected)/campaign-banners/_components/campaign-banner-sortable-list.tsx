"use client";

import type { DragEndEvent } from "@dnd-kit/react";
import { FormMessage } from "@publira/ui-components/form-message";
import { useCallback, useOptimistic, useState, useTransition } from "react";

import { useClientMessages } from "#components/client-message";
import * as Sortable from "#components/sortable-list";

import { reorderCampaignBannersAction } from "../_lib/actions";

interface CampaignBannerSortableListProps {
  /** One row per banner, composed on the server, in the tenant's order. */
  rows: Sortable.Row[];
  tenantId: string;
}

const identity = (id: string): string => id;

/**
 * The order of the banner rows, and the write that changes it.
 *
 * A move posts the whole order rather than the one banner that moved, because
 * that is what `ReorderCampaignBanners` takes: the order the screen was showing
 * goes up beside the order it wants, and a list someone else has changed in
 * the meantime is refused instead of merged.
 */
export const CampaignBannerSortableList = ({
  rows,
  tenantId,
}: CampaignBannerSortableListProps) => {
  const t = useClientMessages();
  const bannerIds = rows.map((row) => row.id);
  const [isPending, startTransition] = useTransition();
  const [optimisticBannerIds, setOptimisticBannerIds] = useOptimistic(
    bannerIds,
    (_currentBannerIds, nextBannerIds: string[]) => nextBannerIds
  );
  const [reorderErrorMessage, setReorderErrorMessage] = useState("");

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const currentBannerIds = optimisticBannerIds;
      const nextBannerIds = Sortable.withItemMoved(
        currentBannerIds,
        identity,
        event
      );
      if (nextBannerIds === currentBannerIds) {
        return;
      }

      startTransition(async () => {
        setOptimisticBannerIds(nextBannerIds);

        const formData = new FormData();
        formData.set("tenant_id", tenantId);
        formData.set("campaign_banner_ids", JSON.stringify(nextBannerIds));
        // The order the list was rendered from, so a console left open while
        // someone else moved a banner is refused rather than merged.
        formData.set(
          "expected_campaign_banner_ids",
          JSON.stringify(currentBannerIds)
        );

        const result = await reorderCampaignBannersAction(formData);
        setReorderErrorMessage(result.ok ? "" : (result.message ?? ""));
      });
    },
    [optimisticBannerIds, setOptimisticBannerIds, tenantId]
  );

  return (
    <div className="grid gap-3">
      {reorderErrorMessage ? (
        <FormMessage variant="destructive">{reorderErrorMessage}</FormMessage>
      ) : null}
      <Sortable.Root
        aria-label={t("admin.campaign_banners.list_title")}
        className="grid gap-3"
        onDragEnd={handleDragEnd}
      >
        <Sortable.Rows
          disabled={isPending}
          order={optimisticBannerIds}
          rows={rows}
        />
      </Sortable.Root>
    </div>
  );
};
