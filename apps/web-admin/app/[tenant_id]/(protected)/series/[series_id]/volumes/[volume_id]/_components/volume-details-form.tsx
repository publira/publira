import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
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

import { VolumeDetailsFields } from "../../_components/volume-details-fields";
import { updateVolumeAction } from "../../_lib/actions";

interface VolumeDetailsFormProps {
  currency: string;
  seriesId: string;
  tenantId: string;
  volume: VolumeItem;
}

/** The title and the price, which `UpdateVolume` replaces together. */
export const VolumeDetailsForm = ({
  currency,
  seriesId,
  tenantId,
  volume,
}: VolumeDetailsFormProps) => (
  <AdminSection>
    <AdminSectionHeader>
      <AdminSectionHeading>
        <AdminSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="admin.series.volumes.form.details_title" />
          </Suspense>
        </AdminSectionTitle>
        <AdminSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.series.volumes.form.details_description" />
          </Suspense>
        </AdminSectionDescription>
      </AdminSectionHeading>
    </AdminSectionHeader>
    <ActionForm action={updateVolumeAction} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_id" type="hidden" value={seriesId} />
      <input name="volume_id" type="hidden" value={volume.id} />
      <ActionFormFieldset className="grid gap-4 sm:grid-cols-2 sm:items-start">
        {/* A save refreshes the page with what the API stored, and that
            remounts the fields on it while the form keeps the message the
            save returned. */}
        <VolumeDetailsFields
          currency={currency}
          initialPrice={volume.price}
          initialTitle={volume.title}
          key={`${volume.title}:${volume.price}`}
        />
      </ActionFormFieldset>
      <div className="flex justify-end">
        <ActionFormSubmit>
          <ActionFormIdle>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="admin.series.volumes.form.update" />
            </Suspense>
          </ActionFormIdle>
          <ActionFormPending>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.series.volumes.form.submitting" />
            </Suspense>
          </ActionFormPending>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  </AdminSection>
);
