import * as ActionForm from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import type { EpisodeEditActionState } from "../episode-edit-types";

interface EpisodeReviewSubmitFormProps {
  action: (
    prevState: EpisodeEditActionState,
    formData: FormData
  ) => Promise<EpisodeEditActionState>;
  episodeId: string;
  episodePublicId: string;
  /** Whether a Tenant admin sent the episode back, rather than never seeing it. */
  returned: boolean;
  seriesPublicId: string;
  tenantId: string;
}

/**
 * Puts a scheduled episode in front of a Tenant admin without moving its
 * time: one returned for changes, once they are made, or one scheduled while
 * the tenant did not yet require review.
 */
export const EpisodeReviewSubmitForm = ({
  action,
  episodeId,
  episodePublicId,
  returned,
  seriesPublicId,
  tenantId,
}: EpisodeReviewSubmitFormProps) => (
  <ActionForm.Root
    action={action}
    className="grid gap-3 border-t border-border pt-4"
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="series_public_id" type="hidden" value={seriesPublicId} />
    <input name="episode_id" type="hidden" value={episodeId} />
    <input name="episode_public_id" type="hidden" value={episodePublicId} />

    <p className="text-sm text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
        {returned ? (
          <Message message="admin.series.episodes.review.submit_returned_description" />
        ) : (
          <Message message="admin.series.episodes.review.submit_unreviewed_description" />
        )}
      </Suspense>
    </p>

    <div className="flex justify-end gap-2">
      <ActionForm.Submit variant="outline">
        <ActionForm.Idle>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.series.episodes.review.submit" />
          </Suspense>
        </ActionForm.Idle>
        <ActionForm.Pending>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.series.episodes.review.submitting" />
          </Suspense>
        </ActionForm.Pending>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);
