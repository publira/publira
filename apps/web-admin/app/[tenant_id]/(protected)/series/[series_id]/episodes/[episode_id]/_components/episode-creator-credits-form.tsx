import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SubmitGate, SubmitGateSubmit } from "#components/submit-gate";

import type {
  EpisodeCreatorCredit,
  EpisodeEditActionState,
} from "../episode-edit-types";
import { EpisodeCreatorCreditsField } from "./episode-creator-credits-field";
import type {
  CreatorOption,
  CreatorRoleOption,
} from "./episode-creator-credits-field";

export const EpisodeCreatorCreditsForm = ({
  action,
  creatorRoles,
  creators,
  episodeId,
  episodePublicId,
  initialCredits,
  seriesPublicId,
  tenantId,
}: {
  action: (
    prevState: EpisodeEditActionState,
    formData: FormData
  ) => Promise<EpisodeEditActionState>;
  creatorRoles: CreatorRoleOption[];
  creators: CreatorOption[];
  episodeId: string;
  episodePublicId: string;
  initialCredits: EpisodeCreatorCredit[];
  seriesPublicId: string;
  tenantId: string;
}) => (
  <section className="grid gap-3 border border-border p-4">
    <h2 className="text-sm font-medium">
      <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
        <Message message="admin.series.episodes.credits.title" />
      </Suspense>
    </h2>
    <p className="text-xs text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-3 w-full" />}>
        <Message message="admin.series.episodes.credits.description" />
      </Suspense>
    </p>
    <p className="text-xs text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-3 w-full" />}>
        <Message message="admin.series.form.creators_share_description" />
      </Suspense>
    </p>
    <ActionForm action={action} className="grid gap-3">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_public_id" type="hidden" value={seriesPublicId} />
      <input name="episode_id" type="hidden" value={episodeId} />
      <input name="episode_public_id" type="hidden" value={episodePublicId} />
      {/* The stored shares already passed the server's cap, so the form opens
          submittable. */}
      <SubmitGate initialSubmittable>
        <ActionFormFieldset className="grid gap-3">
          <EpisodeCreatorCreditsField
            creatorRoles={creatorRoles}
            creators={creators}
            initialCredits={initialCredits}
          />
        </ActionFormFieldset>
        <div className="flex justify-end">
          <SubmitGateSubmit>
            <ActionFormIdle>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.series.episodes.credits.save" />
              </Suspense>
            </ActionFormIdle>
            <ActionFormPending>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.series.episodes.credits.saving" />
              </Suspense>
            </ActionFormPending>
          </SubmitGateSubmit>
        </div>
      </SubmitGate>
    </ActionForm>
  </section>
);
