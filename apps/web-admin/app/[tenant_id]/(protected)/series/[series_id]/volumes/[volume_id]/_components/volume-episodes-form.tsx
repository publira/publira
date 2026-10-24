import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { VolumeItem } from "#lib/volume";

import { setVolumeEpisodesAction } from "../../_lib/actions";
import type { VolumeEpisodeOption } from "../../volume-types";
import { VolumeEpisodesEditor } from "./volume-episodes-editor";

interface VolumeEpisodesFormProps {
  episodes: VolumeEpisodeOption[];
  seriesId: string;
  takenEpisodeIds: string[];
  tenantId: string;
  volume: VolumeItem;
}

/** The episodes the volume holds, which `SetVolumeEpisodes` replaces whole. */
export const VolumeEpisodesForm = ({
  episodes,
  seriesId,
  takenEpisodeIds,
  tenantId,
  volume,
}: VolumeEpisodesFormProps) => {
  // Once the volume has been on sale, what it held then stays in it.
  const hasBeenOnSale = volume.publishedAt.length > 0;

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.series.volumes.episodes.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              {hasBeenOnSale ? (
                <Message message="admin.series.volumes.episodes.locked" />
              ) : (
                <Message message="admin.series.volumes.episodes.description" />
              )}
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      <ActionForm.Root action={setVolumeEpisodesAction} className="grid gap-4">
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="series_id" type="hidden" value={seriesId} />
        <input name="volume_id" type="hidden" value={volume.id} />
        <VolumeEpisodesEditor
          episodes={episodes}
          initialEpisodeIds={volume.episodeIds}
          // A save remounts the editor on the list the API stored.
          key={volume.episodeIds.join(",")}
          lockedEpisodeIds={hasBeenOnSale ? volume.episodeIds : []}
          takenEpisodeIds={takenEpisodeIds}
        />
        <div className="flex justify-end">
          <ActionForm.Submit>
            <ActionForm.Idle>
              <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                <Message message="admin.series.volumes.episodes.save" />
              </Suspense>
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.series.volumes.form.submitting" />
              </Suspense>
            </ActionForm.Pending>
          </ActionForm.Submit>
        </div>
      </ActionForm.Root>
    </ConsoleSection.Root>
  );
};
