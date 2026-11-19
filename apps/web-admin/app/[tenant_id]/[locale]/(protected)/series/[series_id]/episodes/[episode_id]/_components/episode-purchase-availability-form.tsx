import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { PurchaseAvailabilityOverride } from "#lib/purchase-availability";
import type { SurfaceAvailabilityValue } from "#lib/surface-availability";

import { EpisodePurchaseAvailabilityField } from "../../_components/episode-purchase-availability-field";

interface EpisodePurchaseAvailabilityFormProps {
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
  initialPurchaseAvailability: PurchaseAvailabilityOverride;
  /** Where the series sells, resolved through the tenant's default. */
  seriesPurchaseAvailability?: SurfaceAvailabilityValue;
  seriesPublicId: string;
  tenantId: string;
}

export const EpisodePurchaseAvailabilityForm = ({
  action,
  episodeId,
  episodePublicId,
  initialPurchaseAvailability,
  seriesPurchaseAvailability,
  seriesPublicId,
  tenantId,
}: EpisodePurchaseAvailabilityFormProps) => (
  <ConsoleSection.Root>
    <ConsoleSection.Header>
      <ConsoleSection.Heading>
        <ConsoleSection.Title>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.series.episodes.purchase_availability.title" />
          </Suspense>
        </ConsoleSection.Title>
        <ConsoleSection.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <Message message="admin.series.episodes.purchase_availability.description" />
          </Suspense>
        </ConsoleSection.Description>
      </ConsoleSection.Heading>
    </ConsoleSection.Header>
    <ActionForm.Root action={action} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_public_id" type="hidden" value={seriesPublicId} />
      <input name="episode_id" type="hidden" value={episodeId} />
      <input name="episode_public_id" type="hidden" value={episodePublicId} />

      <ActionForm.Fieldset>
        <EpisodePurchaseAvailabilityField
          initialValue={initialPurchaseAvailability}
          seriesPurchaseAvailability={seriesPurchaseAvailability}
        />
      </ActionForm.Fieldset>

      <div className="mt-2 flex justify-end gap-2">
        <ActionForm.Submit>
          <ActionForm.Idle>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.episodes.purchase_availability.update" />
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
  </ConsoleSection.Root>
);
