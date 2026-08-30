"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { useToastManager } from "@publira/ui-components";
import { LinkButton } from "@publira/ui-components/button";
import { formatDateTime } from "@publira/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useOptimistic,
  useRef,
  useTransition,
  useContext,
} from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import type { EpisodeItem } from "#lib/episode";
import { useTenantId } from "#lib/use-tenant-id";

interface EpisodesSortableListProps {
  seriesPublicId: string;
  episodes: EpisodeItem[];
  reorderAction: (
    formData: FormData
  ) => Promise<{ ok: boolean; message?: string }>;
  timeZone: string;
}

const reorderItems = <T extends { publicId: string }>(
  items: T[],
  activeId: string,
  targetId: string
): T[] => {
  if (activeId === targetId) {
    return items;
  }

  const nextItems = [...items];
  const fromIndex = nextItems.findIndex((item) => item.publicId === activeId);
  const toIndex = nextItems.findIndex((item) => item.publicId === targetId);
  if (fromIndex === -1 || toIndex === -1) {
    return items;
  }

  const [moved] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, moved);
  return nextItems;
};

export const EpisodesSortableList = ({
  seriesPublicId,
  episodes,
  reorderAction,
  timeZone,
}: EpisodesSortableListProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const tenantId = useTenantId();
  const router = useRouter();
  const { add } = useToastManager();
  const [isPending, startTransition] = useTransition();
  const [optimisticItems, setOptimisticItems] = useOptimistic(
    episodes,
    (_currentItems, nextItems: EpisodeItem[]) => nextItems
  );
  const draggingEpisodeIdRef = useRef<string | null>(null);

  const submitReorder = useCallback(
    async (currentItems: EpisodeItem[], nextItems: EpisodeItem[]) => {
      const formData = new FormData();
      formData.set("tenant_id", tenantId);
      formData.set("series_public_id", seriesPublicId);
      // Both orders go up: the server merges the new one into the series, and
      // refuses when the series no longer matches the old one.
      formData.set(
        "current_episode_public_ids",
        JSON.stringify(currentItems.map((episode) => episode.publicId))
      );
      formData.set(
        "ordered_episode_public_ids",
        JSON.stringify(nextItems.map((episode) => episode.publicId))
      );
      try {
        const result = await reorderAction(formData);
        if (!result.ok) {
          add({
            title:
              result.message ??
              getMessage(messages, "admin.series.episodes.reorder_failed"),
            type: "error",
          });
          router.refresh();
          return;
        }

        add({
          title: getMessage(messages, "admin.series.episodes.reordered"),
          type: "success",
        });
        router.refresh();
      } catch {
        add({
          title: getMessage(messages, "admin.series.episodes.reorder_failed"),
          type: "error",
        });
        router.refresh();
      }
    },
    [add, messages, reorderAction, router, seriesPublicId, tenantId]
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
    },
    []
  );

  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      draggingEpisodeIdRef.current =
        event.currentTarget.dataset.episodeId ?? null;
    },
    []
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const activeId = draggingEpisodeIdRef.current;
      const targetId = event.currentTarget.dataset.episodeId;
      if (!activeId || !targetId) {
        return;
      }

      // A drag permutes the rows of this page only, so the page's own order
      // indexes are handed back out in ascending slot order. Numbering from 1
      // would be wrong on every page but the first.
      const pageOrderIndexes = optimisticItems
        .map((item) => item.orderIndex)
        .toSorted((a, b) => a - b);
      const nextItems = reorderItems(optimisticItems, activeId, targetId).map(
        (item, index) => ({
          ...item,
          orderIndex: pageOrderIndexes[index] ?? item.orderIndex,
        })
      );

      startTransition(() => {
        setOptimisticItems(nextItems);
      });
      const executeReorder = async () => {
        // The pre-drag order goes up as well, so a stale page is refused
        // instead of merged.
        await submitReorder(optimisticItems, nextItems);
      };
      executeReorder();
      draggingEpisodeIdRef.current = null;
    },
    [optimisticItems, setOptimisticItems, startTransition, submitReorder]
  );

  const handleDragEnd = useCallback(() => {
    draggingEpisodeIdRef.current = null;
  }, []);

  return (
    <div className="grid gap-3">
      {optimisticItems.map((episode) => (
        <div
          className="flex cursor-move items-center justify-between rounded-lg border border-border/70 bg-background px-4 py-3"
          data-episode-id={episode.publicId}
          data-pending={isPending ? "true" : undefined}
          draggable={!isPending}
          key={episode.publicId}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDragStart={handleDragStart}
          onDrop={handleDrop}
        >
          <div className="grid gap-1">
            <p className="text-sm font-medium">
              {episode.orderIndex}. {episode.title}
            </p>
            <p className="text-xs text-muted-foreground">
              {getMessage(messages, "admin.series.episodes.status_price", {
                price: episode.price,
                status: episode.status,
              })}
            </p>
            {episode.status === "scheduled" && episode.scheduledAt ? (
              <p className="text-xs text-yellow-600 dark:text-yellow-400">
                {getMessage(messages, "admin.series.episodes.scheduled_at", {
                  date: formatDateTime(episode.scheduledAt, { timeZone }),
                })}
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
              {getMessage(messages, "admin.series.episodes.edit_action")}
            </LinkButton>
          </div>
        </div>
      ))}
    </div>
  );
};
