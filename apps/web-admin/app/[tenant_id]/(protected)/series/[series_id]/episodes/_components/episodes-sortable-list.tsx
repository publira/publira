"use client";

import { useToastManager } from "@publira/ui-components";
import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useOptimistic, useRef, useTransition } from "react";

import type { EpisodeItem } from "#lib/episode";
import { useTenantId } from "#lib/use-tenant-id";

interface EpisodesSortableListProps {
  seriesPublicId: string;
  episodes: EpisodeItem[];
  reorderAction: (
    formData: FormData
  ) => Promise<{ ok: boolean; message?: string }>;
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
}: EpisodesSortableListProps) => {
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
    async (nextItems: EpisodeItem[]) => {
      const formData = new FormData();
      formData.set("tenant_id", tenantId);
      formData.set("series_public_id", seriesPublicId);
      formData.set(
        "ordered_episode_public_ids",
        JSON.stringify(nextItems.map((episode) => episode.publicId))
      );
      try {
        const result = await reorderAction(formData);
        if (!result.ok) {
          add({
            title: result.message ?? "エピソードの表示順更新に失敗しました。",
            type: "error",
          });
          router.refresh();
          return;
        }

        add({ title: "エピソードの表示順を更新しました。", type: "success" });
        router.refresh();
      } catch {
        add({
          title: "エピソードの表示順更新に失敗しました。",
          type: "error",
        });
        router.refresh();
      }
    },
    [add, reorderAction, router, seriesPublicId, tenantId]
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

      const nextItems = reorderItems(optimisticItems, activeId, targetId).map(
        (item, index) => ({
          ...item,
          orderIndex: index + 1,
        })
      );

      startTransition(() => {
        setOptimisticItems(nextItems);
      });
      const executeReorder = async () => {
        await submitReorder(nextItems);
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
              status: {episode.status} / price: {episode.price}
            </p>
            {episode.status === "scheduled" && episode.scheduledAt ? (
              <p className="text-xs text-yellow-600 dark:text-yellow-400">
                公開予約:{" "}
                {new Date(episode.scheduledAt).toLocaleString("ja-JP", {
                  timeZone: "Asia/Tokyo",
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
              編集
            </LinkButton>
          </div>
        </div>
      ))}
    </div>
  );
};
