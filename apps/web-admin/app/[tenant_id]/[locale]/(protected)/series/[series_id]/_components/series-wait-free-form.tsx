import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Switch } from "@publira/ui-components/switch";
import { Suspense } from "react";

import { Message } from "#components/message";
import {
  MAX_WAIT_FREE_EXCLUDED_LATEST_COUNT,
  MAX_WAIT_FREE_HOURS,
} from "#lib/series-wait-free-shared";
import type { SeriesWaitFreeSettings } from "#lib/series-wait-free-shared";

interface SeriesWaitFreeFormProps {
  action: (
    prevState: ActionForm.State,
    formData: FormData
  ) => Promise<ActionForm.State>;
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
  <ConsoleSection.Root>
    <ConsoleSection.Header>
      <ConsoleSection.Heading>
        <ConsoleSection.Title>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.series.wait_free.title" />
          </Suspense>
        </ConsoleSection.Title>
        <ConsoleSection.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.series.wait_free.description" />
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
              <Message message="admin.series.wait_free.enabled" />
            </Suspense>
          </Field.Label>
          <Field.Description className="col-start-2">
            <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
              <Message message="admin.series.wait_free.enabled_description" />
            </Suspense>
          </Field.Description>
        </Field.Root>

        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.series.wait_free.recharge_hours" />
            </Suspense>
          </Field.Label>
          <Field.Content>
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
            <ActionForm.FieldError name="rechargeHours" />
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <Message
                  message="admin.series.wait_free.recharge_hours_description"
                  values={{ max: String(MAX_WAIT_FREE_HOURS) }}
                />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>

        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.series.wait_free.access_hours" />
            </Suspense>
          </Field.Label>
          <Field.Content>
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
            <ActionForm.FieldError name="accessHours" />
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <Message
                  message="admin.series.wait_free.access_hours_description"
                  values={{ max: String(MAX_WAIT_FREE_HOURS) }}
                />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>

        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.series.wait_free.excluded_latest_count" />
            </Suspense>
          </Field.Label>
          <Field.Content>
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
            <ActionForm.FieldError name="excludedLatestCount" />
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <Message message="admin.series.wait_free.excluded_latest_count_description" />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>
      </ActionForm.Fieldset>

      <div className="mt-2 flex justify-end gap-2">
        <ActionForm.Submit>
          <ActionForm.Idle>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.wait_free.submit" />
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
