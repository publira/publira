import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import type { FormActionState } from "@publira/ui-components/action-form";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
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
import { MAX_INT32 } from "#lib/int32";

interface EpisodePricingFormProps {
  action: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  episodeId: string;
  episodePublicId: string;
  /**
   * The price the episode is sold at. Seeded once per mount, like
   * `initialReadingPeriodHours`: the page keys this form by both, so a saved
   * change remounts it.
   */
  initialPrice: number;
  initialReadingPeriodHours: number;
  seriesPublicId: string;
  tenantId: string;
}

export const EpisodePricingForm = ({
  action,
  episodeId,
  episodePublicId,
  initialPrice,
  initialReadingPeriodHours,
  seriesPublicId,
  tenantId,
}: EpisodePricingFormProps) => (
  <AdminSection>
    <AdminSectionHeader>
      <AdminSectionHeading>
        <AdminSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="admin.series.episodes.pricing.title" />
          </Suspense>
        </AdminSectionTitle>
        <AdminSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <Message message="admin.series.episodes.pricing.description" />
          </Suspense>
        </AdminSectionDescription>
      </AdminSectionHeading>
    </AdminSectionHeader>
    <ActionForm action={action} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_public_id" type="hidden" value={seriesPublicId} />
      <input name="episode_id" type="hidden" value={episodeId} />
      <input name="episode_public_id" type="hidden" value={episodePublicId} />

      <ActionFormFieldset className="grid gap-4">
        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.series.episodes.form.price" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              defaultValue={initialPrice}
              max={MAX_INT32}
              min={0}
              name="price"
              required
              type="number"
            />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.series.episodes.form.price_description" />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.episodes.form.reading_period" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              defaultValue={initialReadingPeriodHours}
              max={MAX_INT32}
              min={0}
              name="reading_period_hours"
              required
              type="number"
            />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.series.episodes.pricing.reading_period_description" />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>
      </ActionFormFieldset>

      <div className="mt-2 flex justify-end gap-2">
        <ActionFormSubmit>
          <ActionFormIdle>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.series.episodes.pricing.update" />
            </Suspense>
          </ActionFormIdle>
          <ActionFormPending>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.series.episodes.updating" />
            </Suspense>
          </ActionFormPending>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  </AdminSection>
);
