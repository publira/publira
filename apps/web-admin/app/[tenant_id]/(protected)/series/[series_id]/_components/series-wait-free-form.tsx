import {
  ActionForm,
  ActionFormFieldError,
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
import { Switch } from "@publira/ui-components/switch";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import {
  MAX_WAIT_FREE_EXCLUDED_LATEST_COUNT,
  MAX_WAIT_FREE_HOURS,
} from "#lib/series-wait-free-shared";
import type { SeriesWaitFreeSettings } from "#lib/series-wait-free-shared";

interface SeriesWaitFreeFormProps {
  action: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  /**
   * The rule as stored, or the API's defaults for a series nobody configured.
   * Seeded once per mount: the page keys this form by it, so a saved change
   * remounts it.
   */
  initialSettings: SeriesWaitFreeSettings;
  seriesId: string;
  seriesPublicId: string;
  tenantId: string;
}

/**
 * The series' wait-for-free rule, saved on its own: the API stores it apart
 * from the series, so the series form's save neither carries nor waits on it.
 * Turning the rule off keeps the numbers for the next time it is turned on.
 */
export const SeriesWaitFreeForm = ({
  action,
  initialSettings,
  seriesId,
  seriesPublicId,
  tenantId,
}: SeriesWaitFreeFormProps) => (
  <AdminSection>
    <AdminSectionHeader>
      <AdminSectionHeading>
        <AdminSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.series.wait_free.title" />
          </Suspense>
        </AdminSectionTitle>
        <AdminSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.series.wait_free.description" />
          </Suspense>
        </AdminSectionDescription>
      </AdminSectionHeading>
    </AdminSectionHeader>
    <ActionForm action={action} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_id" type="hidden" value={seriesId} />
      <input name="series_public_id" type="hidden" value={seriesPublicId} />

      <ActionFormFieldset className="grid gap-4">
        <Field className="grid-cols-[auto_1fr] items-start gap-x-3">
          <Switch
            className="row-span-2 mt-0.5"
            defaultChecked={initialSettings.enabled}
            name="enabled"
          />
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.series.wait_free.enabled" />
            </Suspense>
          </FieldLabel>
          <FieldDescription className="col-start-2">
            <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
              <Message message="admin.series.wait_free.enabled_description" />
            </Suspense>
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.series.wait_free.recharge_hours" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              className="sm:max-w-40"
              defaultValue={initialSettings.rechargeHours}
              max={MAX_WAIT_FREE_HOURS}
              min={1}
              name="recharge_hours"
              required
              step={1}
              type="number"
            />
            <ActionFormFieldError name="rechargeHours" />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <Message
                  message="admin.series.wait_free.recharge_hours_description"
                  values={{ max: String(MAX_WAIT_FREE_HOURS) }}
                />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.series.wait_free.access_hours" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              className="sm:max-w-40"
              defaultValue={initialSettings.accessHours}
              max={MAX_WAIT_FREE_HOURS}
              min={1}
              name="access_hours"
              required
              step={1}
              type="number"
            />
            <ActionFormFieldError name="accessHours" />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <Message
                  message="admin.series.wait_free.access_hours_description"
                  values={{ max: String(MAX_WAIT_FREE_HOURS) }}
                />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.series.wait_free.excluded_latest_count" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              className="sm:max-w-40"
              defaultValue={initialSettings.excludedLatestCount}
              max={MAX_WAIT_FREE_EXCLUDED_LATEST_COUNT}
              min={0}
              name="excluded_latest_count"
              required
              step={1}
              type="number"
            />
            <ActionFormFieldError name="excludedLatestCount" />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <Message message="admin.series.wait_free.excluded_latest_count_description" />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>
      </ActionFormFieldset>

      <div className="mt-2 flex justify-end gap-2">
        <ActionFormSubmit>
          <ActionFormIdle>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.wait_free.submit" />
            </Suspense>
          </ActionFormIdle>
          <ActionFormPending>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.series.form.submitting" />
            </Suspense>
          </ActionFormPending>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  </AdminSection>
);
