"use client";

import type { DragEndEvent } from "@dnd-kit/react";
import { useToastManager } from "@publira/ui-components";
import { LinkButton } from "@publira/ui-components/button";
import { Checkbox } from "@publira/ui-components/checkbox";
import { formatDateTime } from "@publira/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useContext, useOptimistic, useTransition } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import { ClientMessage, useClientMessages } from "#components/client-message";
import {
  SortableItem,
  SortableItemHandle,
  SortableList,
  withItemMoved,
} from "#components/sortable-list";
import type { EpisodeItem } from "#lib/episode";
import { DEFAULT_SURFACE_AVAILABILITY } from "#lib/surface-availability";
import type { SurfaceAvailabilityValue } from "#lib/surface-availability";
import { useTenantId } from "#lib/use-tenant-id";

import { EpisodeAvailabilityBadge } from "./episode-availability-badge";
import {
  selectionCheckboxProps,
  useEpisodeCreditsSelection,
} from "./episode-credits-selection";

interface EpisodesSortableListProps {
  seriesPublicId: string;
  /**
   * What the series is shown on, which bounds every episode. Absent when that
   * read failed, and each row is then marked by its own value alone.
   */
  seriesAvailability?: SurfaceAvailabilityValue;
  episodes: EpisodeItem[];
  reorderAction: (
    formData: FormData
  ) => Promise<{ ok: boolean; message?: string }>;
  timeZone: string;
}

const episodeId = (episode: EpisodeItem): string => episode.publicId;

export const EpisodesSortableList = ({
  seriesPublicId,
  seriesAvailability = DEFAULT_SURFACE_AVAILABILITY,
  episodes,
  reorderAction,
  timeZone,
}: EpisodesSortableListProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const t = useClientMessages();
  const tenantId = useTenantId();
  const { selectedIds, selectMany, toggle } = useEpisodeCreditsSelection();
  const router = useRouter();
  const { add } = useToastManager();
  const [isPending, startTransition] = useTransition();
  const [optimisticItems, setOptimisticItems] = useOptimistic(
    episodes,
    (_currentItems, nextItems: EpisodeItem[]) => nextItems
  );
  const pageIds = optimisticItems.map(episodeId);
  const selectedOnPage = pageIds.filter((publicId) =>
    selectedIds.has(publicId)
  );
  const allOnPageSelected =
    pageIds.length > 0 && selectedOnPage.length === pageIds.length;
  const someOnPageSelected = selectedOnPage.length > 0 && !allOnPageSelected;

  const submitReorder = useCallback(
    async (currentItems: EpisodeItem[], nextItems: EpisodeItem[]) => {
      const formData = new FormData();
      formData.set("tenant_id", tenantId);
      formData.set("series_public_id", seriesPublicId);
      // Both orders go up: the server merges the new one into the series, and
      // refuses when the series no longer matches the old one.
      formData.set(
        "current_episode_public_ids",
        JSON.stringify(currentItems.map(episodeId))
      );
      formData.set(
        "ordered_episode_public_ids",
        JSON.stringify(nextItems.map(episodeId))
      );
      try {
        const result = await reorderAction(formData);
        if (!result.ok) {
          add({
            title: result.message ?? t("admin.series.episodes.reorder_error"),
            type: "error",
          });
          router.refresh();
          return;
        }

        add({
          title: t("admin.series.episodes.reordered"),
          type: "success",
        });
        router.refresh();
      } catch {
        add({
          title: t("admin.series.episodes.reorder_error"),
          type: "error",
        });
        router.refresh();
      }
    },
    [add, t, reorderAction, router, seriesPublicId, tenantId]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const currentItems = optimisticItems;
      const movedItems = withItemMoved(currentItems, episodeId, event);
      if (movedItems === currentItems) {
        return;
      }

      // A drag permutes the rows of this page only, so the page's own order
      // indexes are handed back out in ascending slot order. Numbering from 1
      // would be wrong on every page but the first.
      const pageOrderIndexes = currentItems
        .map((item) => item.orderIndex)
        .toSorted((left, right) => left - right);
      const nextItems = movedItems.map((item, index) => ({
        ...item,
        orderIndex: pageOrderIndexes[index] ?? item.orderIndex,
      }));

      startTransition(async () => {
        setOptimisticItems(nextItems);
        // The pre-drag order goes up as well, so a stale page is refused
        // instead of merged.
        await submitReorder(currentItems, nextItems);
      });
    },
    [optimisticItems, setOptimisticItems, startTransition, submitReorder]
  );

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <Checkbox
          {...selectionCheckboxProps(allOnPageSelected, someOnPageSelected)}
          id="episode-credits-select-page"
          onCheckedChange={(checked) => {
            selectMany(pageIds, checked);
          }}
        />
        <label
          className="text-xs text-muted-foreground"
          htmlFor="episode-credits-select-page"
        >
          {t("admin.series.episodes.credits.select_page")}
        </label>
      </div>
      <SortableList
        aria-label={t("admin.series.episodes.list_title")}
        className="grid gap-3"
        onDragEnd={handleDragEnd}
      >
        {optimisticItems.map((episode, index) => (
          <SortableItem
            className="flex items-center justify-between gap-3 border border-border bg-background px-4 py-3"
            disabled={isPending}
            id={episode.publicId}
            index={index}
            key={episode.publicId}
            label={episode.title}
          >
            <Checkbox
              aria-label={t("admin.series.episodes.credits.select_episode", {
                title: episode.title,
              })}
              checked={selectedIds.has(episode.publicId)}
              onCheckedChange={(checked) => {
                toggle(episode.publicId, checked);
              }}
            />
            <SortableItemHandle>
              <ClientMessage
                message="admin.series.episodes.reorder_action"
                values={{ title: episode.title }}
              />
            </SortableItemHandle>

            <div className="grid flex-1 gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">
                  {episode.orderIndex}. {episode.title}
                </p>
                <EpisodeAvailabilityBadge
                  override={episode.availability}
                  seriesAvailability={seriesAvailability}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                <ClientMessage
                  message="admin.series.episodes.status_price"
                  values={{
                    price: episode.price,
                    status: episode.status,
                  }}
                />
              </p>
              {episode.status === "scheduled" && episode.scheduledAt ? (
                <p className="text-xs text-yellow-600 dark:text-yellow-400">
                  <ClientMessage
                    message="admin.series.episodes.scheduled_at"
                    values={{
                      date: formatDateTime(episode.scheduledAt, {
                        locale,
                        timeZone,
                      }),
                    }}
                  />
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <LinkButton
                render={
                  <Link
                    href={`/series/${seriesPublicId}/episodes/${episode.publicId}`}
                  />
                }
                variant="outline"
              >
                <ClientMessage message="admin.series.episodes.edit_action" />
              </LinkButton>
            </div>
          </SortableItem>
        ))}
      </SortableList>
    </div>
  );
};
