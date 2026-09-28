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

import { PublishAtInput } from "../../_components/publish-at-input";
import type { EpisodeEditActionState } from "../episode-edit-types";

interface EpisodeScheduleFormProps {
  seriesPublicId: string;
  episodeId: string;
  episodePublicId: string;
  scheduledAt?: string;
  action: (
    prevState: EpisodeEditActionState,
    formData: FormData
  ) => Promise<EpisodeEditActionState>;
  tenantId: string;
  timeZone: string;
}

export const EpisodeScheduleForm = ({
  seriesPublicId,
  episodeId,
  episodePublicId,
  scheduledAt = "",
  action,
  tenantId,
  timeZone,
}: EpisodeScheduleFormProps) => (
  <AdminSection>
    <AdminSectionHeader>
      <AdminSectionHeading>
        <AdminSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
            <Message message="admin.series.episodes.schedule_title" />
          </Suspense>
        </AdminSectionTitle>
        <AdminSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <Message message="admin.series.episodes.schedule_description" />
          </Suspense>
        </AdminSectionDescription>
      </AdminSectionHeading>
    </AdminSectionHeader>
    <ActionForm action={action} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_public_id" type="hidden" value={seriesPublicId} />
      <input name="episode_id" type="hidden" value={episodeId} />
      <input name="episode_public_id" type="hidden" value={episodePublicId} />

      <ActionFormFieldset>
        <PublishAtInput initialValue={scheduledAt} timeZone={timeZone}>
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <Message
              message="admin.series.episodes.schedule_publish_at_description"
              values={{ time_zone: timeZone }}
            />
          </Suspense>
        </PublishAtInput>
      </ActionFormFieldset>

      <div className="mt-2 flex justify-end gap-2">
        <ActionFormSubmit>
          <ActionFormIdle>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.episodes.schedule_update" />
            </Suspense>
          </ActionFormIdle>
          <ActionFormPending>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.series.episodes.updating" />
            </Suspense>
          </ActionFormPending>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  </AdminSection>
);
