import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Textarea } from "@publira/ui-components/textarea";
import { Suspense } from "react";

import { Message } from "#components/message";

interface EpisodeReviewDecisionFormProps {
  action: (
    prevState: ActionForm.State,
    formData: FormData
  ) => Promise<ActionForm.State>;
  episodeId: string;
  episodePublicId: string;
  seriesPublicId: string;
  tenantId: string;
}

/**
 * A Tenant admin's decision on the open round. One comment serves both
 * buttons: an approval may say something, and a return has to say what to fix.
 */
export const EpisodeReviewDecisionForm = ({
  action,
  episodeId,
  episodePublicId,
  seriesPublicId,
  tenantId,
}: EpisodeReviewDecisionFormProps) => (
  <ActionForm.Root
    action={action}
    className="grid gap-4 border-t border-border pt-4"
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="series_public_id" type="hidden" value={seriesPublicId} />
    <input name="episode_id" type="hidden" value={episodeId} />
    <input name="episode_public_id" type="hidden" value={episodePublicId} />

    <ActionForm.Fieldset className="grid gap-4">
      <Field.Root>
        <Field.Label>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="admin.series.episodes.review.comment_label" />
          </Suspense>
        </Field.Label>
        <Field.Content>
          <Textarea name="comment" rows={4} />
          <ActionForm.FieldError name="comment" />
          <Field.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
              <Message message="admin.series.episodes.review.comment_description" />
            </Suspense>
          </Field.Description>
        </Field.Content>
      </Field.Root>
    </ActionForm.Fieldset>

    <div className="flex flex-wrap justify-end gap-2">
      <ActionForm.Submit name="decision" value="return" variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          <Message message="admin.series.episodes.review.return" />
        </Suspense>
      </ActionForm.Submit>
      <ActionForm.Submit name="decision" value="approve">
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          <Message message="admin.series.episodes.review.approve" />
        </Suspense>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);
