"use client";

import { useToastManager } from "@publira/ui-components";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useOptimistic, useRef, useTransition } from "react";

import type { EpisodeImageItem } from "#lib/episode";

interface EpisodeImagesSortableGridProps {
  tenantPublicId: string;
  seriesPublicId: string;
  episodePublicId: string;
  images: EpisodeImageItem[];
  reorderAction: (
    formData: FormData
  ) => Promise<{ ok: boolean; message?: string }>;
}

const reorderItems = <T extends { id: string }>(
  items: T[],
  activeId: string,
  targetId: string
): T[] => {
  if (activeId === targetId) {
    return items;
  }

  const nextItems = [...items];
  const fromIndex = nextItems.findIndex((item) => item.id === activeId);
  const toIndex = nextItems.findIndex((item) => item.id === targetId);
  if (fromIndex === -1 || toIndex === -1) {
    return items;
  }

  const [moved] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, moved);
  return nextItems;
};

export const EpisodeImagesSortableGrid = ({
  tenantPublicId,
  seriesPublicId,
  episodePublicId,
  images,
  reorderAction,
}: EpisodeImagesSortableGridProps) => {
  const router = useRouter();
  const { add } = useToastManager();
  const [isPending, startTransition] = useTransition();
  const [optimisticItems, setOptimisticItems] = useOptimistic(
    images,
    (_currentItems, nextItems: EpisodeImageItem[]) => nextItems
  );
  const draggingImageIdRef = useRef<string | null>(null);

  const submitReorder = useCallback(
    async (nextItems: EpisodeImageItem[]) => {
      const formData = new FormData();
      formData.set("tenant_public_id", tenantPublicId);
      formData.set("series_public_id", seriesPublicId);
      formData.set("episode_public_id", episodePublicId);
      formData.set(
        "ordered_image_ids",
        JSON.stringify(nextItems.map((image) => image.id))
      );
      try {
        const result = await reorderAction(formData);
        if (!result.ok) {
          add({
            title: result.message ?? "ページ画像の表示順更新に失敗しました。",
            type: "error",
          });
          router.refresh();
          router.refresh();
          return;
        }

        add({ title: "ページ画像の表示順を更新しました。", type: "success" });
        router.refresh();
      } catch {
        add({
          title: "ページ画像の表示順更新に失敗しました。",
          type: "error",
        });
        router.refresh();
      }
    },
    [
      add,
      episodePublicId,
      reorderAction,
      router,
      seriesPublicId,
      tenantPublicId,
    ]
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
  }, []);

  const handleDragStart = useCallback((event: React.DragEvent<HTMLElement>) => {
    draggingImageIdRef.current = event.currentTarget.dataset.imageId ?? null;
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      const activeId = draggingImageIdRef.current;
      const targetId = event.currentTarget.dataset.imageId;
      if (!activeId || !targetId) {
        return;
      }

      const nextItems = reorderItems(optimisticItems, activeId, targetId).map(
        (item, nextIndex) => ({
          ...item,
          displayOrder: nextIndex + 1,
        })
      );

      startTransition(() => {
        setOptimisticItems(nextItems);
      });
      const executeReorder = async () => {
        await submitReorder(nextItems);
      };
      executeReorder();
      draggingImageIdRef.current = null;
    },
    [optimisticItems, setOptimisticItems, startTransition, submitReorder]
  );

  const handleDragEnd = useCallback(() => {
    draggingImageIdRef.current = null;
  }, []);

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {optimisticItems.map((image, index) => (
        <figure
          aria-disabled={isPending}
          className="grid cursor-move gap-2 rounded-md border border-border/70 bg-background p-2"
          data-image-id={image.id}
          draggable
          key={image.id}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDragStart={handleDragStart}
          onDrop={handleDrop}
        >
          <Image
            alt={`ページ ${index + 1}`}
            className="h-36 w-full rounded object-cover"
            height={Math.max(image.height, 144)}
            src={image.imageUrl}
            unoptimized
            width={Math.max(image.width, 240)}
          />
          <figcaption className="text-xs text-muted-foreground">
            {image.displayOrder} / {image.width}x{image.height}
          </figcaption>
        </figure>
      ))}
    </div>
  );
};
