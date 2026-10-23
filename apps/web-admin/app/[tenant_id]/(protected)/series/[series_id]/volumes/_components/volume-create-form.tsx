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

import { createVolumeAction } from "../_lib/actions";
import { VolumeDetailsFields } from "./volume-details-fields";

interface VolumeCreateFormProps {
  currency: string;
  seriesId: string;
  seriesPublicId: string;
  tenantId: string;
}

/** Adds a volume at the end of the series' volumes, and opens it. */
export const VolumeCreateForm = ({
  currency,
  seriesId,
  seriesPublicId,
  tenantId,
}: VolumeCreateFormProps) => (
  <AdminSection>
    <AdminSectionHeader>
      <AdminSectionHeading>
        <AdminSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.series.volumes.form.create_title" />
          </Suspense>
        </AdminSectionTitle>
        <AdminSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.series.volumes.form.create_description" />
          </Suspense>
        </AdminSectionDescription>
      </AdminSectionHeading>
    </AdminSectionHeader>
    <ActionForm.Root action={createVolumeAction} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_id" type="hidden" value={seriesId} />
      <input name="series_public_id" type="hidden" value={seriesPublicId} />
      <ActionForm.Fieldset className="grid gap-4 sm:grid-cols-2 sm:items-start">
        <VolumeDetailsFields currency={currency} />
      </ActionForm.Fieldset>
      <div className="flex justify-end">
        <ActionForm.Submit>
          <ActionForm.Idle>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="admin.series.volumes.form.create" />
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
