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
import type {
  EpisodeAvailabilityOverride,
  SurfaceAvailabilityValue,
} from "#lib/surface-availability";

import { EpisodeAvailabilityField } from "../../_components/episode-availability-field";

interface EpisodeAvailabilityFormProps {
  action: (
    prevState: ActionForm.State,
    formData: FormData
  ) => Promise<ActionForm.State>;
  episodeId: string;
  episodePublicId: string;
  /**
   * What the episode states of its own. Seeded once per mount: the page keys
   * this form by it, so a saved change remounts it.
   */
  initialAvailability: EpisodeAvailabilityOverride;
  seriesAvailability?: SurfaceAvailabilityValue;
  seriesPublicId: string;
  tenantId: string;
}

export const EpisodeAvailabilityForm = ({
  action,
  episodeId,
  episodePublicId,
  initialAvailability,
  seriesAvailability,
  seriesPublicId,
  tenantId,
}: EpisodeAvailabilityFormProps) => (
  <AdminSection>
    <AdminSectionHeader>
      <AdminSectionHeading>
        <AdminSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.series.episodes.availability.title" />
          </Suspense>
        </AdminSectionTitle>
        <AdminSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <Message message="admin.series.episodes.availability.description" />
          </Suspense>
        </AdminSectionDescription>
      </AdminSectionHeading>
    </AdminSectionHeader>
    <ActionForm.Root action={action} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_public_id" type="hidden" value={seriesPublicId} />
      <input name="episode_id" type="hidden" value={episodeId} />
      <input name="episode_public_id" type="hidden" value={episodePublicId} />

      <ActionForm.Fieldset>
        <EpisodeAvailabilityField
          initialValue={initialAvailability}
          seriesAvailability={seriesAvailability}
        />
      </ActionForm.Fieldset>

      <div className="mt-2 flex justify-end gap-2">
        <ActionForm.Submit>
          <ActionForm.Idle>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.episodes.availability.update" />
            </Suspense>
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.episodes.updating" />
            </Suspense>
          </ActionForm.Pending>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
  </AdminSection>
);
