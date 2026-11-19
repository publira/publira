import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Switch } from "@publira/ui-components/switch";
import { Suspense } from "react";

import { Message } from "#components/message";
import {
  MAX_FREE_AFTER_DAYS,
  MAX_FREE_AFTER_EXCLUDED_LATEST_COUNT,
} from "#lib/series-free-after-shared";
import type { SeriesFreeAfterSettings } from "#lib/series-free-after-shared";

interface SeriesFreeAfterFormProps {
  action: (
    prevState: ActionForm.State,
    formData: FormData
  ) => Promise<ActionForm.State>;
  /**
   * The rule as stored, or the API's defaults for a series nobody configured.
   * Seeded once per mount: the page keys this form by it, so a saved change
   * remounts it.
   */
  initialSettings: SeriesFreeAfterSettings;
  seriesId: string;
  seriesPublicId: string;
  tenantId: string;
}

/**
 * The series' free-after-publication rule, saved on its own: the API stores it
 * apart from the series, so the series form's save neither carries nor waits
 * on it. Turning the rule off keeps the numbers for the next time it is turned
 * on.
 */
export const SeriesFreeAfterForm = ({
  action,
  initialSettings,
  seriesId,
  seriesPublicId,
  tenantId,
}: SeriesFreeAfterFormProps) => (
  <ConsoleSection.Root>
    <ConsoleSection.Header>
      <ConsoleSection.Heading>
        <ConsoleSection.Title>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.series.free_after.title" />
          </Suspense>
        </ConsoleSection.Title>
        <ConsoleSection.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.series.free_after.description" />
          </Suspense>
        </ConsoleSection.Description>
      </ConsoleSection.Heading>
    </ConsoleSection.Header>
    <ActionForm.Root action={action} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_id" type="hidden" value={seriesId} />
      <input name="series_public_id" type="hidden" value={seriesPublicId} />

      <ActionForm.Fieldset className="grid gap-4">
        <Field.Root className="grid-cols-[auto_1fr] items-start gap-x-3">
          <Switch
            className="row-span-2 mt-0.5"
            defaultChecked={initialSettings.enabled}
            name="enabled"
          />
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.series.free_after.enabled" />
            </Suspense>
          </Field.Label>
          <Field.Description className="col-start-2">
            <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
              <Message message="admin.series.free_after.enabled_description" />
            </Suspense>
          </Field.Description>
        </Field.Root>

        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.series.free_after.days_after_publication" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              className="sm:max-w-40"
              defaultValue={initialSettings.daysAfterPublication}
              max={MAX_FREE_AFTER_DAYS}
              min={1}
              name="days_after_publication"
              required
              step={1}
              type="number"
            />
            <ActionForm.FieldError name="daysAfterPublication" />
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <Message
                  message="admin.series.free_after.days_after_publication_description"
                  values={{ max: String(MAX_FREE_AFTER_DAYS) }}
                />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>

        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.series.free_after.excluded_latest_count" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              className="sm:max-w-40"
              defaultValue={initialSettings.excludedLatestCount}
              max={MAX_FREE_AFTER_EXCLUDED_LATEST_COUNT}
              min={0}
              name="excluded_latest_count"
              required
              step={1}
              type="number"
            />
            <ActionForm.FieldError name="excludedLatestCount" />
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <Message message="admin.series.free_after.excluded_latest_count_description" />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>
      </ActionForm.Fieldset>

      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="admin.series.free_after.help" />
        </Suspense>
      </p>

      <div className="mt-2 flex justify-end gap-2">
        <ActionForm.Submit>
          <ActionForm.Idle>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.free_after.submit" />
            </Suspense>
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.series.form.submitting" />
            </Suspense>
          </ActionForm.Pending>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
  </ConsoleSection.Root>
);
