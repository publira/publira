"use client";

import type { DragEndEvent } from "@dnd-kit/react";
import { useToastManager } from "@publira/ui-components";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Suspense, useCallback, useOptimistic, useTransition } from "react";

import { useAdminMessages } from "#components/admin-locale-context";
import { ClientMessage } from "#components/client-message";
import {
  SortableItem,
  SortableItemHandle,
  SortableList,
  withItemMoved,
} from "#components/sortable-list";
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

const imageId = (image: EpisodeImageItem): string => image.id;

export const EpisodeImagesSortableGrid = ({
  seriesPublicId,
  episodePublicId,
  images,
  reorderAction,
}: EpisodeImagesSortableGridProps) => {
  const t = useAdminMessages();
  const tenantId = useTenantId();
  const router = useRouter();
  const { add } = useToastManager();
  const [isPending, startTransition] = useTransition();
  const [optimisticItems, setOptimisticItems] = useOptimistic(
    images,
    (_currentItems, nextItems: EpisodeImageItem[]) => nextItems
  );

  const submitReorder = useCallback(
    async (nextItems: EpisodeImageItem[]) => {
      const formData = new FormData();
      formData.set("tenant_id", tenantId);
      formData.set("series_public_id", seriesPublicId);
      formData.set("episode_public_id", episodePublicId);
      formData.set("ordered_image_ids", JSON.stringify(nextItems.map(imageId)));
      try {
        const result = await reorderAction(formData);
        if (!result.ok) {
          add({
            title:
              result.message ?? t("admin.series.episodes.image_reorder_error"),
            type: "error",
          });
          router.refresh();
          return;
        }

        add({
          title: t("admin.series.episodes.image_reordered"),
          type: "success",
        });
        router.refresh();
      } catch {
        add({
          title: t("admin.series.episodes.image_reorder_error"),
          type: "error",
        });
        router.refresh();
      }
    },
    [add, episodePublicId, reorderAction, t, router, seriesPublicId, tenantId]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const currentItems = optimisticItems;
      const movedItems = withItemMoved(currentItems, imageId, event);
      if (movedItems === currentItems) {
        return;
      }

      const nextItems = movedItems.map((item, index) => ({
        ...item,
        displayOrder: index + 1,
      }));

      startTransition(async () => {
        setOptimisticItems(nextItems);
        await submitReorder(nextItems);
      });
    },
    [optimisticItems, setOptimisticItems, startTransition, submitReorder]
  );

  return (
    <SortableList
      aria-label={t("admin.series.episodes.image_list_title")}
      className="grid grid-cols-2 gap-3 md:grid-cols-3"
      onDragEnd={handleDragEnd}
    >
      {optimisticItems.map((image, index) => (
        <SortableItem
          className="grid gap-2 border border-border bg-background p-2"
          disabled={isPending}
          id={image.id}
          index={index}
          key={image.id}
        >
          <figure className="grid gap-2">
            <Image
              alt={t("admin.series.episodes.image_alt", {
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
            <figcaption className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {image.displayOrder} / {image.width}x{image.height}
              </span>
              <SortableItemHandle>
                <Suspense fallback={null}>
                  <ClientMessage
                    message="admin.series.episodes.image_reorder_action"
                    values={{ position: String(index + 1) }}
                  />
                </Suspense>
              </SortableItemHandle>
            </figcaption>
          </figure>
        </SortableItem>
      ))}
    </SortableList>
  );
};
