import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "#components/action-form";
import type { FormActionState } from "#components/action-form";
import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import type { PurchaseAvailabilityOverride } from "#lib/purchase-availability";
import type { SurfaceAvailabilityValue } from "#lib/surface-availability";

import { EpisodePurchaseAvailabilityField } from "../../_components/episode-purchase-availability-field";

interface EpisodePurchaseAvailabilityFormProps {
  action: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
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
  episodePublicId,
  initialPurchaseAvailability,
  seriesPurchaseAvailability,
  seriesPublicId,
  tenantId,
}: EpisodePurchaseAvailabilityFormProps) => (
  <AdminSection>
    <AdminSectionHeader>
      <AdminSectionHeading>
        <AdminSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.series.episodes.purchase_availability.title" />
          </Suspense>
        </AdminSectionTitle>
        <AdminSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <Message message="admin.series.episodes.purchase_availability.description" />
          </Suspense>
        </AdminSectionDescription>
      </AdminSectionHeading>
    </AdminSectionHeader>
    <ActionForm action={action} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_public_id" type="hidden" value={seriesPublicId} />
      <input name="episode_public_id" type="hidden" value={episodePublicId} />

      <ActionFormFieldset>
        <EpisodePurchaseAvailabilityField
          initialValue={initialPurchaseAvailability}
          seriesPurchaseAvailability={seriesPurchaseAvailability}
        />
      </ActionFormFieldset>

      <div className="mt-2 flex justify-end gap-2">
        <ActionFormSubmit>
          <ActionFormIdle>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.episodes.purchase_availability.update" />
            </Suspense>
          </ActionFormIdle>
          <ActionFormPending>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.episodes.updating" />
            </Suspense>
          </ActionFormPending>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  </AdminSection>
);
