import * as ActionForm from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { EyeCatchFormField } from "#components/eye-catch/form-field";
import { Message } from "#components/message";
import type { EpisodeItem } from "#lib/episode";

import type { EpisodeEditActionState } from "../episode-edit-types";

interface EpisodeEyeCatchFormProps {
  action: (
    prevState: EpisodeEditActionState,
    formData: FormData
  ) => Promise<EpisodeEditActionState>;
  episode: Pick<
    EpisodeItem,
    "eyeCatchImageUpdatedAt" | "eyeCatchImageVariants" | "id"
  >;
  tenantId: string;
}

export const EpisodeEyeCatchForm = ({
  action,
  episode,
  tenantId,
}: EpisodeEyeCatchFormProps) => (
  <ActionForm.Root action={action} className="grid gap-4">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="episode_id" type="hidden" value={episode.id} />

    {/* A save refreshes the page with the eye-catch it stored, and the new
        timestamp remounts the field so the picked file and the delete toggle
        do not outlive the save they were sent with. */}
    <EyeCatchFormField
      eyeCatchImageUpdatedAt={episode.eyeCatchImageUpdatedAt}
      key={episode.eyeCatchImageUpdatedAt}
      variants={episode.eyeCatchImageVariants}
    />

    <div className="flex justify-end">
      <ActionForm.Submit>
        <ActionForm.Idle>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.series.episodes.eye_catch.update" />
          </Suspense>
        </ActionForm.Idle>
        <ActionForm.Pending>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.series.episodes.eye_catch.submitting" />
          </Suspense>
        </ActionForm.Pending>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);
