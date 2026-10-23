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
import { EyeCatchFormField } from "#components/eye-catch/form-field";
import { Message } from "#components/message";
import type { VolumeItem } from "#lib/volume";

import { updateVolumeCoverAction } from "../../_lib/actions";

interface VolumeCoverFormProps {
  seriesId: string;
  tenantId: string;
  volume: VolumeItem;
}

/**
 * Replaces or removes the volume's cover. One image is uploaded and the API
 * cuts every ratio out of it from the centre, so there is no per-ratio slot.
 */
export const VolumeCoverForm = ({
  seriesId,
  tenantId,
  volume,
}: VolumeCoverFormProps) => (
  <AdminSection>
    <AdminSectionHeader>
      <AdminSectionHeading>
        <AdminSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="admin.series.volumes.cover.title" />
          </Suspense>
        </AdminSectionTitle>
        <AdminSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.series.volumes.cover.description" />
          </Suspense>
        </AdminSectionDescription>
      </AdminSectionHeading>
    </AdminSectionHeader>
    <ActionForm.Root action={updateVolumeCoverAction} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_id" type="hidden" value={seriesId} />
      <input name="volume_id" type="hidden" value={volume.id} />
      {/* A save refreshes the page with the cover it stored, and the new
          timestamp remounts the field so the picked file and the delete
          toggle do not outlive the save they were sent with. */}
      <div className="max-w-60">
        <EyeCatchFormField
          eyeCatchImageUpdatedAt={volume.coverImageUpdatedAt}
          key={volume.coverImageUpdatedAt}
          variants={volume.coverImageVariants}
        />
      </div>
      <div className="flex justify-end">
        <ActionForm.Submit>
          <ActionForm.Idle>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.volumes.cover.update" />
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
