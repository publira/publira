"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { useToastManager } from "@publira/ui-components";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useOptimistic, useRef, useTransition } from "react";

import type { EpisodeImageItem } from "#lib/episode";
import { useTenantId } from "#lib/use-tenant-id";

interface EpisodeImagesSortableGridProps {
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
  seriesPublicId,
  episodePublicId,
  images,
  reorderAction,
}: EpisodeImagesSortableGridProps) => {
  const messages = sharedCatalog(
    typeof document === "undefined" ? undefined : document.documentElement.lang
  );
  const tenantId = useTenantId();
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
      formData.set("tenant_id", tenantId);
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
            title:
              result.message ??
              getMessage(
                messages,
                "admin.series.episodes.image_reorder_failed"
              ),
            type: "error",
          });
          router.refresh();
          return;
        }

        add({
          title: getMessage(messages, "admin.series.episodes.image_reordered"),
          type: "success",
        });
        router.refresh();
      } catch {
        add({
          title: getMessage(
            messages,
            "admin.series.episodes.image_reorder_failed"
          ),
          type: "error",
        });
        router.refresh();
      }
    },
    [
      add,
      episodePublicId,
      messages,
      reorderAction,
      router,
      seriesPublicId,
      tenantId,
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
        // Drag-and-drop reordering is intentionally on the figure container.
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <figure
          className="grid cursor-move gap-2 rounded-md border border-border/70 bg-background p-2"
          data-image-id={image.id}
          data-pending={isPending ? "true" : undefined}
          draggable={!isPending}
          key={image.id}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDragStart={handleDragStart}
          onDrop={handleDrop}
        >
          <Image
            alt={getMessage(messages, "admin.series.episodes.image_alt", {
              index: index + 1,
            })}
            className="h-36 w-full rounded object-cover"
            height={Math.max(image.height, 144)}
            // The cell is one grid column wide, not the manuscript page's own
            // width, so the loader is asked for the column instead of the original.
            sizes="(max-width: 768px) 50vw, 33vw"
            src={image.imageUrl}
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
