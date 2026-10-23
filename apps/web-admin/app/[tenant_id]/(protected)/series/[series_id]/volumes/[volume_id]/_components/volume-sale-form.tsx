import * as ActionForm from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import type { VolumeItem } from "#lib/volume";

import { VolumeStatusChip } from "../../_components/volume-status";
import { publishVolumeAction } from "../../_lib/actions";

interface VolumeSaleFormProps {
  seriesId: string;
  tenantId: string;
  volume: VolumeItem;
}

/**
 * Whether the volume is on sale, and the one control that flips it. A volume
 * holding no episodes cannot go on sale, so the control is closed until it
 * holds one.
 */
export const VolumeSaleForm = ({
  seriesId,
  tenantId,
  volume,
}: VolumeSaleFormProps) => {
  const isEmpty = volume.episodeIds.length === 0;

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.series.volumes.sale.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.series.volumes.sale.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <ActionForm.Root action={publishVolumeAction} className="grid gap-4">
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="series_id" type="hidden" value={seriesId} />
        <input name="volume_id" type="hidden" value={volume.id} />
        <input
          name="published"
          type="hidden"
          value={volume.published ? "0" : "1"}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <div>
              <VolumeStatusChip published={volume.published} />
            </div>
            {!volume.published && isEmpty ? (
              <p className="text-sm text-muted-foreground">
                <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                  <Message message="admin.series.volumes.sale.no_episodes" />
                </Suspense>
              </p>
            ) : null}
          </div>
          <ActionForm.Submit
            disabled={!volume.published && isEmpty}
            variant={volume.published ? "outline" : "default"}
          >
            <ActionForm.Idle>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                {volume.published ? (
                  <Message message="admin.series.volumes.sale.unpublish" />
                ) : (
                  <Message message="admin.series.volumes.sale.publish" />
                )}
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
    </AdminSection>
  );
};
